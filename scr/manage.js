const fingerprint = require('./fingerprint');
const db = require('./db');
const browser = require('./browser');
const utils = require('../utils');
const fs = require('fs');
const config = require('../config');

process.on('uncaughtException', (err) => {
    console.error(err);
});

let active = {};

async function saveFP(dir){
    let fp = await fingerprint();
    let data = JSON.parse(fp);
    fs.writeFileSync(dir +'/fp.json', JSON.stringify(data));
};

let create_Profile = async function (name, options) {
    let dir;
    let storageType = await utils.storageType;
    switch(storageType){
      case 'Cloud':
        dir = config.cloudDir + `profiles/${name}`;
        break;
      case 'Local':
        dir = config.storageDir + `profiles/${name}`;
        break;
    };
    if (fs.existsSync(dir))
        return console.log(utils.timeLog() + 
        ` Profile's folder ${name} already created. If you want to create new profile ${name} then delete folder ${name} in ${config.cloudDir + 'profiles'}.`);
    fs.mkdirSync(dir, { recursive: true });
    let profile = {
        name: name,
        open: '',
        proxy: '',
        fingerprint: '',
    };
    if (options && options.fingerprint == true){
        await saveFP(dir);
        profile.fingerprint = true;
    };
    await db.update_Profile(name, profile);
    return console.log(utils.timeLog() + ` Profile ${name} created`);
};

let open_Profile = async function (name){
    let check = await db.check_Profile(name);
    if (!check)
        return console.log(utils.timeLog() + ` Profile ${name} is not exist`);
    let profile = await db.get_Profile(name);
    check = await profile.get('open');
    if (check == true && check != undefined)
        return console.log(utils.timeLog() + ` Profile ${name} already open`);
    console.log(utils.timeLog() + ` Opening profile ${name}...`);
    let dir;
    let storageType = await utils.storageType;
    switch(storageType){
      case 'Cloud':
        dir = config.cloudDir + `profiles/${name}`;
        break;
      case 'Local':
        dir = config.storageDir + `profiles/${name}`;
        break;
    };
    if (!fs.existsSync(dir))
        await create_Profile(name, {fingerprint: true});
    if (!fs.existsSync(dir + '/fp.json'))
        await saveFP(dir);
    let page = await browser.launch(name, profile);
    await db.open_Profile(name);
    active[name] = page;
    console.log(utils.timeLog() + ` Profile ${name} open`);
    return page;
};



let set_ProfileProxy = async function (name, proxy){
    let profileData = {};
    let proxySplit = proxy.split(':');
    profileData.proxyType = proxySplit[0];
    proxySplit.shift();
    profileData.proxy = proxySplit.join(':');
    await db.update_Profile(name, profileData);
};

let delete_ProfileProxy = async function (name){
    let profileData = {};
    profileData.proxy = ' ';
    await db.update_Profile(name, profileData);
};

let change_ProfileFP = async function (name){
    let profileData = {};
    let dir = config.cloudDir + `profiles/${name}`;
    await saveFP(dir);
    profileData.fingerprint = 1;
    await db.update_Profile(name, profileData);
};

let delete_ProfileFP = async function (name){
    let dir = config.cloudDir + `profiles/` + name;
    let profileData = {};
    profileData.fingerprint = '';
    await db.update_Profile(name, profileData);
    try {
        fs.rmSync(dir + '/fingerprint.json', { recursive: true });
        console.log(utils.timeLog() + ` Profile ${name}. Fingerprint is deleted`);
    }
    catch (error) {
        console.log(utils.timeLog() + ' Fingerprint delete error');
    };
};

// let add_ProfileTag = async function (name, tag){
//     let profileData = await db.get_Profile(name);
//     if (profileData.tags.includes(tag))
//         return;
//     profileData.tags.push(tag);
//     await db.update_Profile(name, profileData);
// };

// let delete_ProfileTag = async function (name, tag){
//     let profileData = await db.get_Profile(name);
//     if (profileData.tags.indexOf(tag) < 0)
//         return;
//     profileData.tags.splice(profileData.tags.indexOf(tag), 1);
//     await db.update_Profile(name, profileData);
// };

let rename_Profile = async function (name, newName){
    let dir = config.cloudDir + `profiles/`;
    let profileData = {};
    profileData.name = newName;
    await db.update_Profile(name, profileData);
    try {
        fs.renameSync(`${dir + name}`, `${dir + newName}`);
        console.log(utils.timeLog() + ' Profile renamed');
    } 
    catch (error) {
        console.log(utils.timeLog() + ' Rename error');
    };
};

let delete_Profile = async function (name) {
    let dir = config.cloudDir + `profiles/` + name;
    await db.delete_Profile(name);
    try {
        fs.rmSync(dir, { recursive: true });
        console.log(utils.timeLog() + ` Profile ${name} is deleted`);
    } 
    catch (err) {
        console.error(utils.timeLog() + ` Error while deleting profile ${name}`);
    };
    // console.log(utils.timeLog() + ' The profile folder is saved on the cloud, to completely delete the profile, delete the profile folder from the shared profile storage');
};

let get_ProfilesNames = async function (){
    let profiles = await db.get_Profiles();
    let names = [];
    for (let i = 0; i < profiles.length; i++)
        if (profiles[i].name != undefined)
            names.push(profiles[i].name)
    return names;
};





module.exports.create_Profile = create_Profile;
module.exports.open_Profile = open_Profile;
module.exports.set_ProfileProxy = set_ProfileProxy;
module.exports.active = active;
module.exports.get_ProfilesNames = get_ProfilesNames;
module.exports.delete_Profile = delete_Profile;
module.exports.rename_Profile = rename_Profile;
module.exports.change_ProfileFP = change_ProfileFP;
module.exports.delete_ProfileFP = delete_ProfileFP;
module.exports.delete_ProfileProxy = delete_ProfileProxy;