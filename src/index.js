/**
 * mss — Smart Routing Engine (المرحلة 3)
 * نقطة دخول موحدة
 */
module.exports = require('./router');
module.exports.featuresModule = require('./features');
module.exports.classifierModule = require('./classifier');
module.exports.storeModule = require('./store');
module.exports.cacheModule = require('./cache');
module.exports.gatewayModule = require('./gateway');
