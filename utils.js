const figlet = require('figlet');
const db = require('./scr/db');


let storageType;
let engine = 'main';

function printLogo(){
  return console.log(figlet.textSync('bro.dev', {
    font: 'Slant',
    horizontalLayout: 'default',
    verticalLayout: 'default',
    width: 200,
    whitespaceBreak: true
  }));
};

function menu(){
  let arr = ['1. New profile'];
  let i = 1;
  for (let profile of db.get_Profiles()){
    i++;
    arr.push(`${i}. ${profile}`);
  };
  return arr;
};

function timeLog(){
  let now = new Date();
  let hours = now.getHours();
  let minutes = now.getMinutes();
  let seconds = now.getSeconds();
  if (hours < 10)
    hours = `0${hours}`;
  if (minutes < 10)
    minutes = `0${minutes}`;
  if (seconds < 10)
    seconds = `0${seconds}`;
  return `${hours}:${minutes}:${seconds} >>> `;
};


module.exports.printLogo = printLogo;
module.exports.menu = menu;
module.exports.timeLog = timeLog;
module.exports.storageType = storageType;
module.exports.engine = engine;