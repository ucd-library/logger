import express from 'express';
import { createLogger, logReqMiddleware } from '../lib/index.js';

let logger = createLogger({
  'name': 'test-logger',
  labels : {
    testing : 1
  }
});
let app = express();
app.use(logReqMiddleware(logger, {
  debug : [/^\/health\/?/]
  // ignore : [/^\/health\/?/]
}));

app.get('/', (req, res) => {
  logger.info('test info');
  logger.error(new Error('test error'));
  res.send('Hello World!');
});

app.get('/array', (req, res) => {
  logger.info('test array', ['a', 'b', 'c']);
  res.send('array test');
});

app.get('/health', (req, res) => {
  res.send('test');
});

let port = process.env.PORT || 3000;
app.listen(port, () => {
  logger.info('Example app listening on port '+port+'!');
});