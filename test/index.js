import express from 'express';
import { createLogger, logReqMiddleware } from '../index.js';

let logger = createLogger({
  'name': 'test-logger',
  labels : {
    testing : 1
  }
});
let app = express();
app.use(logReqMiddleware(logger));

app.get('/', (req, res) => {
  logger.info('test info');
  logger.error(new Error('test error'));
  res.send('Hello World!');
});

let port = process.env.PORT || 3000;
app.listen(port, () => {
  logger.info('Example app listening on port '+port+'!');
});