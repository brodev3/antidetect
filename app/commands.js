const inquirer = require('inquirer');
const utils = require('../utils');
const manage = require('../scr/manage');
const db = require('../scr/db');
const fs = require('fs');
const path = require('path');

let create_Profile = async function(){
    let name = false;
    await inquirer.prompt([{
        type: 'input',
        name: 'newProfile',
        message: 'Enter the name of the new profile:',
        prefix: utils.timeLog(),
      },
    ]).then(async (answers) => {
        name = answers.newProfile;
        if (typeof answers.newProfile == "string" && answers.newProfile != "")
            await manage.create_Profile(answers.newProfile, {fingerprint: true});
        else 
            return console.log(utils.timeLog() + 'Invalid name!');
    });
    return name;
};

let setNewProxy = async function(name){
    let proxy = {}
    let answers = await inquirer.prompt([{
        type: 'list',
        name: 'type',
        message: 'Select the protocol of your proxy:',
        prefix: utils.timeLog(),
        choices: [ 
            'HTTP/HTTPS',
            'SOCKS5',
            new inquirer.Separator(), 
            'Back', 
        ],
      }
    ]);
    switch (answers.type){
        case 'HTTP/HTTPS':
            proxy.type = 'https';
            break;
        case 'SOCKS5':
            proxy.type = 'socks5';
            break;
        case 'Back': 
            return;
    }; 
    answers = await inquirer.prompt([{
        type: 'input',
        name: 'proxy',
        message: 'Enter proxy (ex. 111.01.1.111:2000:Login:Pass):',
        prefix: utils.timeLog(),
    }]);
    if (typeof answers.proxy == "string" && answers.proxy != ""){
        await manage.set_ProfileProxy(name, `${proxy.type}:` + answers.proxy);
        console.log(utils.timeLog() + ' Proxy set');
    }
    else {
        console.log(utils.timeLog() + ' Invalid proxy!');
    };       
};

let rename_Profile = async function(name){
    let answers = await inquirer.prompt([{
        type: 'input',
        name: 'newName',
        message: 'Enter the new name of the profile:',
        prefix: utils.timeLog(),
      },
    ]);
    if (typeof answers.newName == "string" && answers.newName != "")
        await manage.rename_Profile(name, answers.newName);
    else {
        console.log(utils.timeLog() + ' Invalid name!');
        return name;
    };  
    return answers.newName;
};

let openSelected = async function(){
    let profiles = await db.get_Selected();
    console.log(utils.timeLog() + 'Selected profiles: ' + profiles);
    for (let i = 0; i < profiles.length; i++){
        await manage.open_Profile(profiles[i]);
    };
};

let deleteSelected = async function(){
    let profiles = await db.get_Selected();
    console.log(utils.timeLog() + 'Selected profiles: ' + profiles);
    for (let i = 0; i < profiles.length; i++){
        manage.delete_Profile(profiles[i]);
    };
};

let newEngine = function(){
    let count = db.get_Engines().length+1;
    const parentDir = path.resolve(__dirname, '..');
    fs.mkdirSync(parentDir + '/engines/data' + count, { recursive: true });
    console.log(utils.timeLog() + 'Created engine: ' + 'data' + count);
};

let setEngine = function(name){
    utils.engine = name;
    console.log(utils.timeLog() + 'Selected engine: ' + name);
};

module.exports.setNewProxy = setNewProxy;
module.exports.rename_Profile = rename_Profile;
module.exports.create_Profile = create_Profile;
module.exports.openSelected = openSelected;
module.exports.deleteSelected = deleteSelected;
module.exports.newEngine = newEngine;
module.exports.setEngine = setEngine;