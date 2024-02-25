const config = require('../config');
const utils = require('../utils');
const db = require('./db');
const { plugin } = require('playwright-with-fingerprints');
const fs = require('fs');
const manage = require('./manage');

let launch = async function (name, profile){
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

  let options = {
    profile: {},
    proxy: {
      changeTimezone: true,
      changeGeolocation: true,
      changeBrowserLanguage: true,
    }
  };
  
  if (await profile.get('fingerprint') == true){
    let fp = JSON.stringify(JSON.parse(fs.readFileSync(dir + '/fp.json')));
    plugin.useFingerprint(fp);
  }
  else 
    options.profile.loadFingerprint = false;

  let proxyType = await profile.get('proxyType');
  if (!proxyType == false){
    let proxy = await profile.get('proxy');
    let login = proxy.split(':', -2);
    proxy = proxy.split(':', 2);
    plugin.useProxy(`${proxyType}://${login.join(":")}:${proxy.join(":")}`, 
      options.proxy);
  }
  else 
    options.profile.loadProxy = false;

  plugin.useProfile(dir, options.profile);
 
  let browser = await plugin.launchPersistentContext(dir, {
    headless: false,
    ignoreDefaultArgs: ["--enable-automation", `--allow-file-access-from-files`],
    
  });
  browser.name = name;
  browser.on('close', async data => {
    console.log(utils.timeLog() + `Profile ${name} closed`);
    delete manage.active[name];
    switch(storageType){
      case 'Cloud':
        setTimeout(db.close_Profile, 180000, name);
        break;
      case 'Local':
        setTimeout(db.close_Profile, 7000, name);
        break;
    };
  });

  let page = await browser.newPage();
  try{
    await page.goto('https://abrahamjuliot.github.io/creepjs/');
  }
  catch(err){
    await page.goto('https://google.com/');
  }
  let pages = browser.pages();
  for (let i = 0; i < pages.length; i++){
    let url = pages[i].url();
    if (url == 'about:blank')
      pages[i].close();
  };
  return page;
};

module.exports.launch = launch;






  



