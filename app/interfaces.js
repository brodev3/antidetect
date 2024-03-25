const inquirer = require('inquirer');
const manage = require('../scr/manage');
const utils = require('../utils');
const db = require('../scr/db');
const commands = require('./commands');

let start = async function(){
    console.clear();
    utils.printLogo();
    inquirer.prompt([
    {
      type: 'list',
      pageSize: 20,
      name: 'section',
      message: 'Select a section:',
      prefix: utils.timeLog(),
      choices: [
        new inquirer.Separator(), 
        'Profiles',
        'Dashboard',
        'Multiprocessing',
        'About',
        new inquirer.Separator(), 
        'Exit',
      ],
    }
    ]).then(async (answers) => {
        switch(answers.section) {
            case 'Multiprocessing':
                multiprocessing();
                break;
            case 'Exit':
                process.exit(1);
            case 'Profiles':
                return storage_Type();
            case 'Dashboard':
                return dashboard();
        };
  });
};

let multiprocessing = async function(){
    let choices = db.get_Engines();
    choices.unshift(new inquirer.Separator(), 'New engine');
    choices.push(new inquirer.Separator(), 'Back');
    inquirer.prompt([
        {
          type: 'list',
          pageSize: 20,
          name: 'multiprocessing',
          message: 'Select a menu item:',
          prefix: utils.timeLog(),
          choices: choices,
        }
    ]).then(async (answers) => {
        switch(answers.multiprocessing){
            case 'New engine':
                commands.newEngine();
                return multiprocessing();
            case 'Back':
                return start();
        };
        commands.setEngine(answers.multiprocessing);
        return multiprocessing();
    });
};

let dashboard = async function(){
    inquirer.prompt([
        {
          type: 'list',
          pageSize: 20,
          name: 'dashboard',
          message: 'Select a menu item:',
          prefix: utils.timeLog(),
          choices: [
            new inquirer.Separator(), 
            'Connect', 
            new inquirer.Separator(), 
            'Back'
          ],
        }
    ]).then(async (answers) => {
        switch(answers.dashboard){
            case 'Connect':
                console.log(`${utils.timeLog()}`+
                'A link for authorization in the Google API will be sent shortly. Please log in with the account that owns the spreadsheet to obtain a service account token for interaction with the Google API through your application.')
                utils.dashboard = 'Cloud';
                break;
            case 'Back':
                return start();
        };
        return profiles_Menu();
    });
};

let storage_Type = async function(){
    inquirer.prompt([
        {
          type: 'list',
          pageSize: 20,
          name: 'storageType',
          message: 'Select a type of storage:',
          prefix: utils.timeLog(),
          choices: [
            new inquirer.Separator(), 
            'Cloud', 
            'Local', 
            new inquirer.Separator(), 
            'Back'
          ],
        }
    ]).then(async (answers) => {
        switch(answers.storageType){
            case 'Cloud':
                utils.storageType = 'Cloud';
                break;
            case 'Local':
                utils.storageType = 'Local';
                break;
            case 'Back':
                return start();
        };
        return profiles_Menu();
    });
};

let profiles_Menu = async function(){
    inquirer.prompt([
        {
          type: 'list',
          pageSize: 20,
          name: 'profileAction',
          message: 'Select a menu item:',
          prefix: utils.timeLog(),
          choices: [
            new inquirer.Separator(), 
            'New profile', 
            'List of profiles', 
            'Selected in the table',
            new inquirer.Separator(), 
            'Back'
          ],
        }
    ]).then(async (answers) => {
        switch(answers.profileAction){
            case 'New profile':
                let name = await commands.create_Profile();
                if (name != false)
                    return profile_Action(name);
                else    
                    return profiles_Menu(name);
            case 'List of profiles':
                return profiles();
            case 'Selected in the table':
                return selected_Actions();
            case 'Back':
                return start();
        };
    });
};

let profiles = async function(){
    let names = await db.get_Profiles();
    names.push(new inquirer.Separator(), 'Back');
    names.unshift(new inquirer.Separator());
    inquirer.prompt([
    {
      type: 'rawlist',
      pageSize: 20,
      name: 'profile',
      message: 'Select a profile:',
      prefix: utils.timeLog(),
      choices: names,
    }]).then(async (answers) => {
        switch(answers.profile){
            case 'Back':
                return profiles_Menu();
        };
        return profile_Action(answers.profile);
    });
};

let selected_Actions = async function(){
    await inquirer.prompt([{
        type: 'list',
        name: 'action',
        message: 'Select an action:',
        prefix: utils.timeLog(),
        choices: [ 
            new inquirer.Separator(), 
            'Open selected profiles',
            'Delete selected profiles',
            new inquirer.Separator(), 
            'Back', 
        ]
    }]).then(async (answers) => {
        switch(answers.action){
            case 'Open selected profiles':
                await commands.openSelected();
                break;
            case 'Delete selected profiles':
                await manage.deleteSelected();
                break;
            case 'Back':
                return await profiles_Menu();                
        };
        return;
    });
}

let profile_Action = async function (profile){
    let pdata = await db.get_Profile(profile);
    let message;
    let open = await pdata.get('open');
    if (open == true)
        message = `Profile: ${profile}\nOpen: true\n`
    else 
        message = `Profile: ${profile}\nOpen: false\n`
    let proxy = await pdata.get('proxy');
    if (proxy == false || proxy == undefined)
        message = message + `Proxy: false The real ip\n`
    else {
        proxy = proxy.split(':');
        proxy = proxy[0] + ':' + proxy[1];
        let proxyType = await pdata.get('proxyType');
        message = message + `Proxy: true
Type: ${proxyType}
IP: ${proxy}\n`;
    }
    let fingerprint = await pdata.get('fingerprint');
    if (fingerprint == false || fingerprint == undefined)
        message = message + `Fingerprint: false\n`;
    else
        message = message + `Fingerprint: true\n`;
    inquirer.prompt([{
      type: 'list',
      name: 'action',
      pageSize: 31,
      message: message + 'Select an action:',
      prefix: utils.timeLog(),
      choices: [ 
        new inquirer.Separator(),
        'Open', 
        'Proxy', 
        'Fingerprint',
        // 'Extensions', 
        'Rename',
        'Delete',
        new inquirer.Separator(), 
        'Back', 
        'Back to menu'
    ],
    },
  ]).then(async (answers) => {
    switch(answers.action) {
        case 'Back':
            return profiles();
        case 'Back to menu':
            return start();
        case 'Open':
            manage.open_Profile(profile).then(() => profiles());
            break;
        case 'Info':
            return start();
        case 'Proxy':
            return proxy_Profile(profile);
        case 'Fingerprint':
            return await fp_Profile(profile);
        // case 'Extensions':
        //     return start();
        case 'Rename':
            let name = await commands.rename_Profile(profile);
            return profile_Action(name);
        case 'Delete':
            await manage.delete_Profile(profile);
            return profiles();
    };
  });
};

let proxy_Profile = async function(name){
    let fpdata = await db.get_Profile(name);
    let proxy = await fpdata.get('proxy');
    let proxyType = await fpdata.get('proxyType');
    let message;
    if (proxy == false || proxy == undefined){
        message = `Proxy: false. The real ip\n${utils.timeLog()} Select an action:`
    }
    else {
        let ip = proxy.split(":");
        proxy = ip[0] + ':' + ip[1];
        message = `Proxy: True.
Type: ${proxyType}
IP: ${proxy}
${utils.timeLog()} Select an action:`;
    };
    await inquirer.prompt([{
        type: 'list',
        name: 'action',
        message: message,
        prefix: utils.timeLog(),
        choices: [ 
            new inquirer.Separator(), 
            'Set new proxy',
            'Delete proxy',
            new inquirer.Separator(), 
            'Back', 
        ]
    }]).then(async (answers) => {
        switch(answers.action){
            case 'Set new proxy':
                await commands.setNewProxy(name);
                break;
            case 'Delete proxy':
                await manage.delete_ProfileProxy(name);
                break;
            case 'Back':
                return await profile_Action(name);                
        };
        return await proxy_Profile(name);
    });
};

let fp_Profile = async function(name){
    let fpdata = await db.get_Profile(name);
    let fingerprint = await fpdata.get('fingerprint');
    if (fingerprint == false || fingerprint == undefined){
        inquirer.prompt([{
            type: 'list',
            name: 'action',
            message: `Fingerprint: False\n${utils.timeLog()} Select an action:`,
            prefix: utils.timeLog(),
            choices: [ 
                new inquirer.Separator(), 
                'Set new fingerprint',
                new inquirer.Separator(), 
                'Back', 
            ]}]).then(async (answers) => {
            if (answers.action == "Set new fingerprint"){
                await manage.change_ProfileFP(name);
                console.log(utils.timeLog() + ' Fingerprint set');
                return profile_Action(name);
            };
            if (answers.action == "Back")
                return profile_Action(name);
            });
    }
    else{
        inquirer.prompt([{
            type: 'list',
            name: 'action',
            message: `Fingerprint: True\n${utils.timeLog()} Select an action:`,
            prefix: utils.timeLog(),
            choices: [ 
                new inquirer.Separator(), 
              'Change fingerprint',
              'Delete fingerprint',
              new inquirer.Separator(), 
              'Back', 
            ]
        }]).then(async (answers) => {
            if (answers.action == "Change fingerprint"){
                await manage.change_ProfileFP(name);
                console.log(utils.timeLog() + ' Fingerprint changed');
                return profile_Action(name);
            };
            if (answers.action == "Delete fingerprint"){
                await manage.delete_ProfileFP(name);
                console.log(utils.timeLog() + ' Fingerprint deleted');
                return profile_Action(name);
            };
            if (answers.action == "Back")
                return profile_Action(name);
        });
    };
};


module.exports.start = start;


