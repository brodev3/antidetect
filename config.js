require('dotenv').config();

const cloudDir = process.env.DIR;
const storageDir = __dirname + '/storage/';
const tags = ['Email', 'Gmail', 'Twitter', 'Metamask', 'Phantom', 'Discord'];
const googleEmail = process.env.GOOGLEEMAIL;
const googleKey = process.env.GOOGLEKEY;
const googleSheetID = process.env.GOOGLESHEETID;
const fpkey = process.env.FPKEY

module.exports.fpkey = fpkey;
module.exports.cloudDir = cloudDir;
module.exports.storageDir = storageDir;
module.exports.tags = tags;
module.exports.googleEmail = googleEmail;
module.exports.googleKey = googleKey;
module.exports.googleSheetID = googleSheetID;