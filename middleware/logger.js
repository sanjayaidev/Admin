/**
 * Request Logger Middleware
 * Logs every incoming request, response status, and detailed errors.
 */

const logger = (req, res, next) => {
  const start = Date.now();
  
  // Capture original end function
  const originalEnd = res.end;

  // Override res.end to log after response is sent
  res.end = function(...args) {
    const duration = Date.now() - start;
    const status = res.statusCode;
    const color = status >= 500 ? '\x1b[31m' : status >= 400 ? '\x1b[33m' : '\x1b[32m'; // Red, Yellow, Green
    const reset = '\x1b[0m';
    
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} - ${status} (${duration}ms)`);
    
    // Call original end
    originalEnd.apply(res, args);
  };

  // Catch errors in the pipeline
  next();
};

// Detailed Error Logger
const errorLogger = (err, req, res, next) => {
  console.error('\n\x1b[31m[ERROR]\x1b[0m', new Date().toISOString());
  console.error(`Method: ${req.method} URL: ${req.originalUrl}`);
  console.error(`User ID: ${req.user ? req.user.id : 'Anonymous'}`);
  console.error(`IP: ${req.ip}`);
  console.error('Error Details:', err.message);
  if (err.stack) {
    console.error('Stack Trace:', err.stack);
  }
  console.error('Request Body:', JSON.stringify(req.body, null, 2));
  console.error('Query Params:', JSON.stringify(req.query, null, 2));
  console.error('----------------------------------------\n');

  // Send generic error to client (don't leak stack traces)
  res.status(err.status || 500).json({
    success: false,
    message: process.env.NODE_ENV === 'production' ? 'Internal Server Error' : err.message,
    error: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
};

module.exports = { logger, errorLogger };
