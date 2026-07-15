// middleware/auth.js
// Authentication and authorization middleware

const { validateSession } = require('../lib/auth');

// Middleware: Check if user is authenticated
async function requireAuth(req, res, next) {
  const token = req.cookies.session_token;
  
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  const user = await validateSession(token);
  
  if (!user) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
  
  // Normalize org_id to match database column naming
  req.user = {
    ...user,
    org_id: user.orgId  // Add org_id alias for compatibility
  };
  next();
}

// Middleware: Check if user has specific role(s)
function requireRole(allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ 
        error: `Access denied. Required roles: ${allowedRoles.join(', ')}` 
      });
    }
    
    next();
  };
}

// Middleware: Check if user is admin
const requireAdmin = requireRole(['admin']);

// Middleware: Optional auth (user may or may not be logged in)
async function optionalAuth(req, res, next) {
  const token = req.cookies.session_token;
  
  if (token) {
    const user = await validateSession(token);
    if (user) {
      req.user = user;
    }
  }
  
  next();
}

module.exports = {
  requireAuth,
  requireRole,
  requireAdmin,
  optionalAuth
};
