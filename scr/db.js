const config = require('../config');
const { JWT } = require('google-auth-library');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { RateLimiter } = require("limiter");
const fs = require('fs');
const path = require('path');

const auth = new JWT({
    email: config.googleEmail,
    key: config.googleKey,
    scopes: [
    'https://www.googleapis.com/auth/spreadsheets',
    ]
});

const doc = new GoogleSpreadsheet(config.googleSheetID, auth);
const limiter = new RateLimiter({ tokensPerInterval: 45, interval: "minute" });

let db = {};
let sheet;

async function connect(){
    await doc.loadInfo(); 
    sheet = doc.sheetsByIndex[0];
    await sheet.loadHeaderRow(1);
};

async function check_Profile(name){
    await limiter.removeTokens(4);
    await connect();
    let rows = await sheet.getRows();
    for (let i = 0; i < rows.length; i++){
        if (rows[i].get('name') == name){
            return true;
        };
    };
    return false;
};

async function update_Profile(name, data){
    await limiter.removeTokens(5);
    await connect();
    let check = await check_Profile(name);
    if (check == false)
        await sheet.addRow(data, {insert: true})
    else {
        let row = await get_Profile(name);
        await row.assign(data);
        await row.save();
    };  
};

async function get_Profile(name){
    await limiter.removeTokens(4);
    await connect();
    let rows = await sheet.getRows();
    for (let i = 0; i < rows.length; i++){
        if (rows[i].get('name') == name)
            return rows[i];
    };
    return false;
};

let open_Profile = async function(name){
    await limiter.removeTokens(4);
    await connect();
    let profile = await get_Profile(name);
    await profile.assign({open: 1});
    await profile.save();
};

let close_Profile = async function(name){
    await limiter.removeTokens(3);
    await connect();
    let profile = await get_Profile(name);
    await profile.assign({open: ' '});
    await profile.save();
};

async function delete_Profile(name){
    await limiter.removeTokens(2);
    let row = await get_Profile(name);
    if (row)
        await row.delete();
};

let get_Profiles = async function(){
    await limiter.removeTokens(2);
    await connect();
    let arr = [];
    let rows = await sheet.getRows();
    rows.forEach(async row => {
        arr.push(await row.get('name'));
    });
     return arr;
};

async function get_Selected(){
    await limiter.removeTokens(3);
    await connect();
    let res = [];
    let rows = await sheet.getRows();
    for (let i = 0; i < rows.length; i++){
        if (await rows[i].get('select') == 'X'){
            let name = await rows[i].get('name');
            res.push(name);
        };
    };
    return res;
};

function get_Engines(){
    const parentDir = path.resolve(__dirname, '..');
    const engines = fs.readdirSync(parentDir + '/engines');
    return engines;
};

module.exports.update_Profile = update_Profile;
module.exports.check_Profile = check_Profile;
module.exports.get_Profile = get_Profile;
module.exports.open_Profile = open_Profile;
module.exports.close_Profile = close_Profile;
module.exports.delete_Profile = delete_Profile;
module.exports.get_Selected = get_Selected;
// module.exports.add_Tag = add_Tag;
// module.exports.delete_Tag = delete_Tag;
module.exports.get_Profiles = get_Profiles;
module.exports.get_Engines = get_Engines;
