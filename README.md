# logger
Simple JSON logger based on a combo of Bunyan and GC Logging [LogEntry spec](https://cloud.google.com/logging/docs/reference/v2/rest/v2/LogEntry)

Contents:
- [Usage](#usage)
- [Options](#options)
- [How it works](#how-it-works)
- [Logging Requests](#logging-requests)

## Usage
```javascript
const {createLogger} = require('@ucd-lib/logger');
const logger = new Logger({
  name : 'my-logger'
});

logger.info('Hello World');
```

## Options

| Option | Env Var | Default Value |
|----------|----------|----------|
| name | LOG_NAME | ucdlib-logger |
| level | LOG_LEVEL | info  |
| hostname | LOG_HOSTNAME | `os.hostname()` |
| labelsKey | LOG_LABELS_KEY | logging.googleapis.com/labels |
| labelsProperties | LOG_LABELS_PROPERTIES | name, hostname, corkTraceId |
| errorKeys  | LOG_ERROR_KEYS  | e, err, error  |

- `name`: The name of the logger.  This will be the name of the log stream in the JSON output.
- `level` : The log level.  One of `trace`, `debug`, `info`, `warn`, `error`, `fatal`. All calls to the logger will be logged at this level or higher.
- `hostname` : The hostname of the machine running the logger.
- `labelsKey` : The key to use for labels in the JSON output.  Set to `false` to disable labels and all labels will stay in the root of the JSON output. Default is `logging.googleapis.com/labels` which is the key used by Google Cloud Logging.
- `labelsProperties` : A comma separated list of properties to include in the labels object.
- `errorKeys` : A comma separated list of keys to look for in the log message objects for an an `Error` object.  If an error object is found, it will be serialized and added to the log message.

## How it works.

You can log as many arguments as you want.  Each argument should be a string or an object.  All objects passed will be merged into a single object.  All strings will be concatenated into a single string sperated by a `;` and set as the `message` property of the log object. The following properties will be added to the log object:

- `message` : The string representation of all string arguments passed to the logger.
- `name` : The name of the logger.
- `hostname` : The hostname of the machine running the logger.
- `time` : The current time in ISO format.
- `severity` : The log level.  Based on the logger function called.
- `httpRequest` : Only if the `req` and `res` objects are passed (see more below).

Additionally `labelsProperties` will be moved to the `labelsKey` property if set.


## Logging Requests

There is built in middleware for logging requests. 

Example:
```javascript
import express from 'express';
import {logReqMiddleware, createLogger} from '@ucd-lib/logger';

const app = express();
const logger = createLogger({
  name : 'my-logger'
});

app.use(logReqMiddleware(logger));

app.get('/', (req, res) => {
  res.send('Hello World');
});

app.listen(3000, () => {
  logger.info('Server running on port 3000');
});
```

This middleware will:
  - Format the `req` and `res` objects as the [LogEntry HttpRequest object](https://cloud.google.com/logging/docs/reference/v2/rest/v2/LogEntry#HttpRequest).
  - Timing information will be added to the log message, added to the `latency` property of the `httpRequest` object.
  - The log message will be logged at the `INFO` level unless the response status code is 5xx, in which case it will be logged at the `ERROR` level.
  - Check for the `corkTraceId` property on the `req` object or `cork-trace-id` in the headers. If found, add it to the log message as a label. If the `corkTraceId` property is not found, a new `corkTraceId` will be generated and added to the `req` object, `cork-trace-id` added to the `req.header` (for use by a later proxy), added to the log message as a label.

Alternatively, you could, though not receommended, log the request manually:
```javascript
logger.info({req, res, reqTimeInMs});
```