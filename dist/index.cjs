"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.createLogger = createLogger;
exports.logReqMiddleware = logReqMiddleware;
var _os = _interopRequireDefault(require("os"));
var _uuid = require("uuid");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { "default": e }; }
function _typeof(o) { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) { return typeof o; } : function (o) { return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o; }, _typeof(o); }
// docs on GC Logging special fields:
// https://cloud.google.com/logging/docs/agent/logging/configuration#special-fields

var hostname = _os["default"].hostname();
var allLevels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
var consoleMap = {
  trace: 'log',
  debug: 'log',
  info: 'log',
  warn: 'warn',
  error: 'error',
  fatal: 'error'
};
var ERROR_KEYS = ['err', 'error', 'e'];
var LABELS_KEY = 'logging.googleapis.com/labels';
var LOG_LABELS_PROPERTIES = ['name', 'hostname', 'corkTraceId'];
var DEFAULT_LEVEL = 'info';
var DEFAULT_TIME_PROPERTY = 'time';

/**
 * @function compareLevels
 * @description Compare two log levels.  Returns a negative number if a is less than b,
 * a positive number if a is greater than b, and 0 if they are equal.
 * 
 * @param {*} a 
 * @param {*} b 
 * @returns 
 */
function compareLevels(a, b) {
  return allLevels.indexOf(a) - allLevels.indexOf(b);
}

// formatted for: https://cloud.google.com/logging/docs/reference/v2/rest/v2/LogEntry
function getHttpRequestObject(req, res, reqTimeInMs) {
  var latency = undefined;
  if (reqTimeInMs !== undefined) {
    latency = (reqTimeInMs / 1000).toFixed(3) + 's';
  }
  var o = {
    requestMethod: req.method,
    requestUrl: req.protocol + '://' + req.get('host') + req.originalUrl,
    requestSize: req.get('content-length'),
    status: res.statusCode,
    userAgent: req.get('User-Agent'),
    remoteIp: req.get('x-forwarded-for') || req.ip,
    referer: req.get('referer'),
    latency: latency,
    protocol: "".concat(req.protocol.toUpperCase(), "/").concat(req.httpVersion)
  };
  for (var key in o) {
    if (o[key] === undefined) {
      delete o[key];
    }
  }
  return o;
}

// pretty print error objects
function errorSerializer(err) {
  if (err instanceof Error) {
    return {
      message: err.message,
      detail: err.detail,
      stack: err.stack
    };
  }
  return err;
}
function renderTemplate(template, data) {
  return template.replace(/\${([^}]*)}/g, function (match, key) {
    var value = data;
    var notFound = false;
    key.split('.').forEach(function (k) {
      if (notFound) return;
      if (value[k] === undefined) {
        notFound = true;
        return;
      }
      value = value[k];
    });
    return value;
  });
}
function buildPayload(args, severity) {
  var opts = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : {};
  var params = {
    name: opts.name
  };
  var message = [];

  // check input arguments for objects, errors, and strings
  args.forEach(function (arg) {
    if (_typeof(arg) === 'object') {
      if (arg instanceof Error) {
        params.error = errorSerializer(arg);
        return;
      }
      Object.assign(params, arg);
    } else {
      message.push(arg);
    }
  });

  // if req and res passed, set httpRequest object
  // https://cloud.google.com/logging/docs/reference/v2/rest/v2/LogEntry#HttpRequest
  var originalUrl;
  if (params.req && params.res) {
    originalUrl = params.req.originalUrl;
    params.httpRequest = getHttpRequestObject(params.req, params.res, params.reqTimeInMs);
    if (params.req.corkTraceId) {
      params.corkTraceId = params.req.corkTraceId;
    }

    // if status is 500 or greater, at least set severity to ERROR
    if (params.httpRequest.status > 500 && compareLevels(severity, 'error') < 0) {
      params.severity = 'ERROR';
    }
    delete params.req;
    delete params.res;
    delete params.reqTimeInMs;
  }

  // check for error keys and serialize
  opts.errorKeys.forEach(function (key) {
    if (params[key] && params[key] instanceof Error) {
      params[key] = errorSerializer(params[key]);
    }
  });

  // merge multiple string messages into one
  if (params.message) {
    message.push(params.message);
  }
  params.message = message.join('; ');

  // if message is empty, try to build one from httpRequest or error
  if (params.message === '') {
    if (params.httpRequest) {
      params.message = params.httpRequest.requestMethod + ' ' + params.httpRequest.status + ' ' + params.httpRequest.latency + ' ' + (originalUrl || params.httpRequest.requestUrl);
    } else if (params.error) {
      params.message = params.error.message;
    } else {
      delete params.message;
    }
  }

  // if no hostname, use opts.hostname or os.hostname()
  params.hostname = opts.hostname;

  // move some properties to labels
  opts.labelsProperties.forEach(function (key) {
    makeLabel(params, key, opts);
  });
  if (opts.labels) {
    for (var key in opts.labels) {
      params[key] = opts.labels[key];
      makeLabel(params, key, opts);
    }
  }

  // set severity
  params.severity = severity;

  // set timestamp
  params[opts.timeProperty] = new Date().toISOString();

  // if( opts.src ) {
  //   let src = new Error().stack.split('\n')[3].trim().match(/\(([^)]+)\)/);
  //   params.src = src;
  // }

  return params;
}
function makeLabel(params, key, opts) {
  if (!params[key]) {
    return;
  }
  if (opts.labelsKey === false) {
    return;
  }
  var labelsKey = opts.labelsKey || LABELS_KEY;
  if (params[labelsKey] === undefined) {
    params[labelsKey] = {};
  }
  params[labelsKey][key] = params[key];
  delete params[key];
}
function createLogger() {
  var opts = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
  if (opts.src === undefined && process.env.LOG_SRC === 'true') {
    opts.src = true;
  }
  if (!opts.name) {
    opts.name = process.env.LOG_NAME || 'ucdlib-logger';
  }
  if (!opts.labelsKey) {
    opts.labelsKey = process.env.LOG_LABELS_KEY || LABELS_KEY;
    if (opts.labelsKey === 'false') {
      opts.labelsKey = false;
    }
  }
  if (!opts.labelsProperties) {
    opts.labelsProperties = process.env.LOG_LABELS_PROPERTIES ? process.env.LOG_LABELS_PROPERTIES.split(',').map(function (p) {
      return p.trim();
    }) : LOG_LABELS_PROPERTIES;
  }
  if (!opts.hostname) {
    opts.hostname = process.env.LOG_HOSTNAME || hostname;
  }
  if (!opts.level) {
    opts.level = opts.level || process.env.LOG_LEVEL || DEFAULT_LEVEL;
  }
  opts.level = opts.level.toLowerCase();
  if (!opts.errorKeys) {
    opts.errorKeys = process.env.LOG_ERROR_KEYS ? process.env.LOG_ERROR_KEYS.split(',').map(function (k) {
      return k.trim();
    }) : ERROR_KEYS;
  }
  if (!opts.timeProperty) {
    opts.timeProperty = process.env.LOG_TIME_PROPERTY || DEFAULT_TIME_PROPERTY;
  }
  var logger = {
    level: opts.level
  };
  allLevels.forEach(function (level) {
    var severity = level.toUpperCase();
    logger[level] = function () {
      if (compareLevels(level, logger.level) < 0) {
        return;
      }
      var args = Array.prototype.slice.call(arguments);
      var log = buildPayload(args, severity, opts);
      console.log(JSON.stringify(log));
      // console[consoleMap[level]](JSON.stringify(log));
    };
  });
  logger.info('Logger initialized', opts);
  return logger;
}

/**
 * @function logReqMiddleware
 * @description Middleware function to log incoming requests and responses as
 * well as the time it takes to process the request.
 * Additionally, adds a corkTraceId to the request object and header if it does not already exist.
 * 
 * @param {Object} logger instance of a logger created by createLogger 
 * @returns 
 */
function logReqMiddleware(logger) {
  return function (req, res, next) {
    if (process.env.LOG_REQ === 'false') {
      return next();
    }
    var start = Date.now();
    if (!req.corkTraceId) {
      req.corkTraceId = req.get('cork-trace-id') || (0, _uuid.v4)();
    }
    if (!req.get('cork-trace-id')) {
      req.headers['cork-trace-id'] = req.corkTraceId;
    }
    res.on('finish', function () {
      var reqTimeInMs = Date.now() - start;
      logger.info({
        req: req,
        res: res,
        reqTimeInMs: reqTimeInMs
      });
    });
    next();
  };
}