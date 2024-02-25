const config = require('../config');
const { JWT } = require('google-auth-library');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { RateLimiter } = require("limiter");

// let db = {};
// db.profiles = new Datastore({
//     filename: config.cloudDir + 'DB_profiles.db'
// });
// db.tags = new Datastore({
//     filename: config.cloudDir + 'DB_tags.db'
// });
// db.proxies = new Datastore({
//     filename: config.cloudDir + 'DB_proxies.db'
// });

// let check_Profile = async function(name){
//     await db.profiles.loadDatabaseAsync();
//     let profile = await db.profiles.findAsync({name: `${name}`});
//     if (profile.length != 0)
//         return true;
//     else 
//         return false;
// };

// let insert_Profile = async function(data){
//     await db.profiles.loadDatabaseAsync();
//     await db.profiles.insertAsync(data);
//     await db.profiles.loadDatabaseAsync();
// };

// let update_Profile = async function(name, data){
//     await db.profiles.loadDatabaseAsync();
//     await db.profiles.update({ name: `${name}` }, data, { upsert: true });
//     await db.profiles.loadDatabaseAsync();
// };

// let get_Profile = async function(name){
//     await db.profiles.loadDatabaseAsync();
//     let profile = await db.profiles.findOneAsync({name: `${name}`});
//     return profile;
// };

// let open_Profile = async function(name){
//     let profile = await get_Profile(name);
//     profile.open = true;
//     await update_Profile(name, profile);
// };

// let close_Profile = async function(name){
//     let profile = await get_Profile(name);
//     profile.open = false;
//     await update_Profile(name, profile);
// };

// let delete_Profile = async function(name){
//     await db.profiles.loadDatabaseAsync();
//     await db.profiles.removeAsync({name: `${name}`});
//     await db.profiles.loadDatabaseAsync();
// };

// let check_Tag = async function(name){
//     await db.tags.loadDatabaseAsync();
//     let tag = await db.tags.findAsync({name: `${name}`});
//     if (tag.length != 0)
//         return true;
//     else 
//         return false;
// };

// let add_Tag = async function(name){
//     await db.tags.loadDatabaseAsync();
//     await db.tags.insertAsync({name: name});
//     await db.tags.loadDatabaseAsync();
// };

// let delete_Tag = async function(name){
//     await db.tags.loadDatabaseAsync();
//     await db.tags.removeAsync({name: name});
//     await db.tags.loadDatabaseAsync();
// };

// let get_Profiles = async function(){
//     await db.profiles.loadDatabaseAsync();
//     let profiles = await db.profiles.findAsync().sort({ _id: -1 });
//     return profiles;
// };

const auth = new JWT({
    email: config.googleEmail,
    key: config.googleKey,
    scopes: [
    'https://www.googleapis.com/auth/spreadsheets',
    ]
});

const doc = new GoogleSpreadsheet(config.googleSheetID, auth);
const limiter = new RateLimiter({ tokensPerInterval: 50, interval: "minute" });

let db = {};
let sheet;

async function connect(){
    await doc.loadInfo(); 
    sheet = doc.sheetsByIndex[0];
    await sheet.loadHeaderRow(1);
};

async function check_Profile(name){
    await limiter.removeTokens(2);
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
    await limiter.removeTokens(4);
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
    await limiter.removeTokens(3);
    await connect();
    let rows = await sheet.getRows();
    for (let i = 0; i < rows.length; i++){
        if (rows[i].get('name') == name)
            return rows[i];
    };
    return false;
};

let open_Profile = async function(name){
    await limiter.removeTokens(3);
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
