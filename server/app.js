'use strict';

const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');

const config = require('./config/env');
const requestContext = require('./middlewares/helpers/requestContext');
const requireDatabase = require('./middlewares/helpers/requireDatabase');
const { errorMiddleware } = require('./middlewares/errors/errorMiddleware');
const apiNotFound = require('./middlewares/errors/notFound');

const healthRouter = require('./routes/healthRoute');
const propertyRouter = require('./routes/propertyRoute');
const aiRouter = require('./routes/aiRoute');

// Legacy e-commerce routers retained from the original template. They are Mongo-backed
// and therefore gated behind `requireDatabase`.
const orderRouter = require('./routes/orderRoute');
const paymentRouter = require('./routes/paymentRoute');
const productRouter = require('./routes/productRoute');
const userRouter = require('./routes/userRoute');

const app = express();

// Needed for correct client IPs (rate limiting) behind a proxy or load balancer.
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(requestContext);
app.use(
  cors({
    origin: config.corsOrigins,
    credentials: true,
    exposedHeaders: ['X-Request-Id', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'Retry-After'],
  })
);
// A body limit keeps a malformed or hostile request from being parsed into memory.
app.use(express.json({ limit: config.jsonBodyLimit }));
app.use(express.urlencoded({ extended: true, limit: config.jsonBodyLimit }));
app.use(cookieParser());

/* ------------------------------------------------------------------- routes */

app.use('/api/health', healthRouter);
app.use('/api/properties', propertyRouter);
app.use('/api/ai', aiRouter);

app.use('/api/order', requireDatabase, orderRouter);
app.use('/api/payment', requireDatabase, paymentRouter);
app.use('/api/product', requireDatabase, productRouter);
app.use('/api/user', requireDatabase, userRouter);

// Unmatched API paths must not fall through to the SPA handler below, or a `fetch()`
// caller gets HTML where it expected JSON.
app.use('/api', apiNotFound);

/* ------------------------------------------------- static assets / SPA shell */

const buildDirectory = path.resolve(__dirname, '..', 'build');

if (config.isProduction) {
  app.use(express.static(buildDirectory));
  app.get('*', (req, res) => res.sendFile(path.join(buildDirectory, 'index.html')));
} else {
  // In development the CRA dev server serves the UI on :3000 and proxies /api here.
  app.get('/', (req, res) => {
    res.type('text/plain').send('RentVerse API is running. Try GET /api/health');
  });
}

/* ------------------------------------------------------------ error handling */

// Registered last: Express routes errors to the first handler with four arguments.
app.use(errorMiddleware);

module.exports = app;
