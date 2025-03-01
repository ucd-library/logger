const os = require('os');
const uuid = require('uuid');

// docs on GC Logging special fields:
// https://cloud.google.com/logging/docs/agent/logging/configuration#special-fields

const hostname = os.hostname();
let allLevels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];


let consoleMap = {
  trace: 'log',
  debug: 'log',
  info: 'log',
  warn: 'warn',
  error: 'error',
  fatal: 'error'
}
let ERROR_KEYS = ['err', 'error', 'e'];
const LABELS_KEY = 'logging.googleapis.com/labels';
const LOG_LABELS_PROPERTIES = ['name', 'hostname', 'corkTraceId'];
const DEFAULT_LEVEL = 'info';

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
  let latency = undefined;
  if( reqTimeInMs !== undefined ) {
    latency = (reqTimeInMs / 1000).toFixed(3)+'s';
  }

  let o = {
    requestMethod: req.method,
    requestUrl: req.protocol+'://'+req.get('host')+req.originalUrl,
    requestSize: req.get('content-length'),
    status: res.statusCode,
    userAgent: req.get('User-Agent'),
    remoteIp: req.get('x-forwarded-for') || req.ip,
    referer: req.get('referer'),
    latency,
    protocol: `${req.protocol.toUpperCase()}/${req.httpVersion}`
  };

  for( let key in o ) {
    if( o[key] === undefined ) {
      delete o[key];
    }
  }

  return o;
}

// pretty print error objects
function errorSerializer(err) {
  if( err instanceof Error ) {
    return {
      message: err.message,
      detail: err.detail,
      stack: err.stack
    }
  }
  return err;
}

function buildPayload(args, severity, opts={}) {
  let params = {
    name: opts.name
  };
  let message = [];

  // check input arguments for objects, errors, and strings
  args.forEach(arg => {
    if( typeof arg === 'object' ) {
      if( arg instanceof Error ) {
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
  if( params.req && params.res ) {
    params.httpRequest = getHttpRequestObject(params.req, params.res, params.reqTimeInMs);
    if( params.req.corkTraceId ) {
      params.corkTraceId = params.req.corkTraceId;
    }

    // if status is 500 or greater, at least set severity to ERROR
    if( params.httpRequest.status > 500 && 
      compareLevels(severity, 'error') < 0 ) {
      params.severity = 'ERROR';
    }

    delete params.req;
    delete params.res;
    delete params.reqTimeInMs;
  }

  // check for error keys and serialize
  opts.errorKeys.forEach(key => {
    if( params[key] && params[key] instanceof Error ) {
      params[key] = errorSerializer(params[key]);
    }
  });

  // merge multiple string messages into one
  if( params.message ) {
    message.push(params.message);
  }
  params.message = message.join('; ');

  // if message is empty, try to build one from httpRequest or error
  if( params.message === '' ) {
    if( params.httpRequest ) {
      params.message = params.httpRequest.requestMethod+' '+
        params.httpRequest.status+' '+
        params.httpRequest.latency+' '+
        params.httpRequest.requestUrl;
    } else if( params.error ) {
      params.message = params.error.message;
    } else {
      delete params.message;
    }
  }

  // if no hostname, use opts.hostname or os.hostname()
  params.hostname = opts.hostname;

  // move some properties to labels
  opts.labelsProperties.forEach(key => {
    makeLabel(params, key, opts);
  });

  // set severity
  params.severity = severity;

  // set timestamp
  params.time = new Date().toISOString();

  // if( opts.src ) {
  //   let src = new Error().stack.split('\n')[3].trim().match(/\(([^)]+)\)/);
  //   params.src = src;
  // }

  return params;
}

function makeLabel(params, key, opts) {
  if( !params[key] ) {
    return;
  }
  if( opts.labelsKey === false ) {
    return;
  }
  
  let labelsKey = opts.labelsKey || LABELS_KEY;

  if( params[labelsKey] === undefined ) {
    params[labelsKey] = {};
  }

  params[labelsKey][key] = params[key];
  delete params[key];
}

function createLogger(opts={}) {
  if( opts.src === undefined && process.env.LOG_SRC === 'true' ) {
    opts.src = true;
  }

  if( !opts.name ) { 
    opts.name = process.env.LOG_NAME || 'ucdlib-logger';
  }

  if( !opts.labelsKey && process.env.LOG_LABELS_KEY ) {
    opts.labelsKey = process.env.LOG_LABELS_KEY || LABELS_KEY;
    if( opts.labelsKey === 'false' ) {
      opts.labelsKey = false;
    }
  }

  if( !opts.labelsProperties && process.env.LOG_LABELS_PROPERTIES ) {
    opts.labelsProperties = process.env.LOG_LABELS_PROPERTIES ? 
      process.env.LOG_LABELS_PROPERTIES.split(',').map(p => p.trim()) :
      LOG_LABELS_PROPERTIES;
  }

  if( !opts.hostname ) {
    opts.hostname = process.env.LOG_HOSTNAME || hostname;
  }

  if( !opts.level ) {
    opts.level = opts.level || process.env.LOG_LEVEL || DEFAULT_LEVEL;
  }
  opts.level = opts.level.toLowerCase();

  if( !opts.errorKeys ) {
    opts.errorKeys = process.env.LOG_ERROR_KEYS ?
      process.env.LOG_ERROR_KEYS.split(',').map(k => k.trim()) : ERROR_KEYS;
  }

  let logger = {
    level : opts.level
  };

  allLevels.forEach(level => {
    let severity = level.toUpperCase();

    logger[level] = function() {
      if( compareLevels(level, logger.level) < 0 ) {
        return;
      }

      let args = Array.prototype.slice.call(arguments);
      let log = buildPayload(args, severity, opts);

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
  return (req, res, next) => {
    let start = Date.now();

    if( !req.corkTraceId ) {
      req.corkTraceId = req.get('cork-trace-id') || uuid.v4();
    }
    if( !req.get('cork-trace-id') ) {
      req.headers['cork-trace-id'] = req.corkTraceId;
    }

    res.on('finish', () => {
      let reqTimeInMs = Date.now() - start;
      logger.info({req, res, reqTimeInMs});
    });
    next();
  }
}


module.exports = {logReqMiddleware, createLogger};