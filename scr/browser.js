const config = require('../config');
const utils = require('../utils');
const db = require('./db');
const { plugin } = require('playwright-with-fingerprints');
const fs = require('fs');
const manage = require('./manage');
const fingerprint = require('./fingerprint');
const AsyncLock = require('async-lock');
const lock = new AsyncLock();
const axios = require('axios');
const {SocksProxyAgent} = require('socks-proxy-agent');
const path = require('path');


let proxyChecker = async function (type, proxy, auth){
  let host = proxy.split(':')[0];
  let port = proxy.split(':')[1]
  let username = auth.split(':')[0];
  let password = auth.split(':')[1];
  let check;
  if (type == 'https'){
    try {
      check = await axios.get('http://ip.bablosoft.com/', {
      proxy: {
        protocol: 'http',
        host: host,
        port: port,
        auth: {
          username,
          password,
        },
      },
    });
    } catch (err){
      check = false;
    }
   };
  if (type == 'socks5'){
    const proxyAgent  = new SocksProxyAgent(`socks5://${username}:${password}@${host}:${port}`);
    const axiosInstance = axios.create({
      httpsAgent: proxyAgent, 
      httpAgent: proxyAgent 
    });
    try {
      check = await axiosInstance.get('http://ip.bablosoft.com/');
    check = check.status;
    } catch (err){
      check = false;
    }
  };
  if (check)
    return true;
  else 
    return false;
};

let engine = function() {
  plugin.setRequestTimeout(120 * 60000);
  let dir = path.resolve(__dirname, '..') + '/engines/' + utils.engine;
  if (utils.engine != 'main')
    plugin.setWorkingFolder(dir);
  else  
    plugin.setWorkingFolder('./data');
};

let launch = async function (name, profile){
  let browser;
  await lock.acquire('key', async () => {
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
      fs.mkdirSync(dir, { recursive: true });

    if (!fs.existsSync(dir + '/fp.json')){
      let fp = await fingerprint();
      let data = JSON.parse(fp);
      fs.writeFileSync(dir +'/fp.json', JSON.stringify(data));
    };

    engine();
    let options = {
      profile: {},
      proxy: {
        changeTimezone: true,
        changeGeolocation: true,
        changeBrowserLanguage: true,
      }
    };
    
    if (await profile.get('fingerprint') > false){
      let fp = JSON.stringify(JSON.parse(fs.readFileSync(dir + '/fp.json')));
      plugin.useFingerprint(fp, {    
        // safeElementSize: true,
        emulateSensorAPI: false,
      });
    }
    else 
      options.profile.loadFingerprint = false;

    let proxyType = await profile.get('proxyType');
    if (!proxyType == false){
      let proxy = await profile.get('proxy');
      let login = proxy.split(':', -2);
      proxy = proxy.split(':', 2);
      login = login[2] + ':' + login[3];
      let check = await proxyChecker(proxyType, proxy.join(":"), login);
      if (check == false){
        console.log(utils.timeLog() + ' Bad proxy at ' + name);
        browser =  false;
        return false;
      } 

      plugin.useProxy(`${proxyType}://${login}:${proxy.join(":")}`, 
        options.proxy);
    }
    else 
      options.profile.loadProxy = false;

    plugin.useProfile(dir, options.profile);
  
    browser = await plugin.launchPersistentContext(dir, {
      headless: false,
      ignoreDefaultArgs: ["--enable-automation", `--allow-file-access-from-files`],
      // args: [
      //   `--disable-extensions-except=E:/farm/antidetect/extentions/phantom`,
      //   `--load-extension=E:/farm/antidetect/extentions/phantom`
      // ]
      
    });

    browser.name = name;
    browser.on('close', async data => {
      let name = data.name;
      console.log(utils.timeLog() + `Profile ${name} closed`);
      delete manage.active[name];
      switch(storageType){
        case 'Cloud':
          setTimeout(db.close_Profile, 5000, name);
          break;
        case 'Local':
          setTimeout(db.close_Profile, 3000, name);
          break;
      };
    });  
  });
  if (browser == false)
    return false;
  
  let page = await browser.newPage();
  try{
    if (name.includes('Grass')){
      try {
        await page.goto('https://app.getgrass.io/dashboard');
      }
      catch (err){
        console.log(utils.timeLog() + ' Bad proxy at ' + name);
        await browser.close();
        page = false;
      }
      // let page2 = await browser.newPage();
      // await page2.goto('https://chromewebstore.google.com/detail/ilehaonighjijnmpnagapkhpcdbhclfg/');
      // let page = await browser.newPage();
      // await page.goto('https://www.google.com/search?q=' + name);
    }
    else
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






  



