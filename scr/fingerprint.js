const { plugin } = require('playwright-with-fingerprints');

let get_Fingerprint = async function(){
  const fingerprint = await plugin.fetch('', {
    tags: ['Microsoft Windows', 'Chrome'],
    safeElementSize: true,
  });
  return fingerprint;
};

module.exports = get_Fingerprint;
