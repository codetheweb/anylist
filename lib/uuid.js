const uuidv4 = require('uuid/v4');

module.exports = () => uuidv4().replace(/-/g, '');
