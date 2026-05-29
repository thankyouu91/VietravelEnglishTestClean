const express = require('express');
const authRoutes = require('./auth');
const statsRoutes = require('./stats');
const sessionRoutes = require('./sessions');
const exportsRoutes = require('./exports');
const itemsRoutes = require('./items');
const pendingReviewRoutes = require('./pending-review');
const invitationsRoutes = require('./invitations');
const examConfigRoutes = require('./exam-config');
const usersRoutes = require('./users');
const reportsRoutes = require('./reports');

const router = express.Router();

router.use(authRoutes);
router.use(statsRoutes);
router.use(sessionRoutes);
router.use(exportsRoutes);
router.use(itemsRoutes);
router.use(pendingReviewRoutes);
router.use(invitationsRoutes);
router.use(examConfigRoutes);
router.use(usersRoutes);
router.use(reportsRoutes);

module.exports = router;
