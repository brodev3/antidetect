const { plugin } = require('playwright-with-fingerprints');
const config = require('../config');

let get_Fingerprint = async function(){
  const fingerprint = await plugin.fetch(config.fpkey, {
    tags: ['Microsoft Windows', 'Chrome', 'Desktop'],
    minWidth: 1440,
    minHeight: 900,
    maxWidth: 1920,
    maxHeight:1080,
  });
  return fingerprint;
};

module.exports = get_Fingerprint;
