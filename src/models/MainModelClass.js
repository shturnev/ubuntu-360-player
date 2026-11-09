import fs from 'fs'
import express from 'express'
import cors from 'cors'
import {dialog, ipcMain} from 'electron'
import {Helper} from './Helper'
import {Media} from "./Media";
import path from 'path'
import ConfigModel from "./ConfigModel";
import Updater from "./Updater";

const homedir = require('os').homedir() + '/.sht-vr-player';
const clr = require('cli-color');
const trash = require('trash');
const getFolderSize = require('get-folder-size');
const rimraf = require("rimraf");

class MainModelClass {

  constructor(win) {
    this.win = win;
    this.serverUrl = undefined;
    this.homedir = homedir;
    this.static_dir = homedir + '/static';
    this.config = new ConfigModel();
  }


  init() {

    Helper.checkDir(homedir);
    this.startFileServer();

    ipcMain.on('open-dir', (event, arg) => {
      this.openDir(event)
    });
    ipcMain.on('get-server-url', (event, arg) => {
      event.reply('start-file-server', this.serverUrl)
    });
    ipcMain.on('delete-selected', (event, arg) => {
      this.deleteSelected(arg)
    });
    ipcMain.on('get-cache-size', (event, arg) => {
      getFolderSize(this.static_dir, async (err, size) => {
        if (err) {
          size = 0
        }
        else{
          size = (size / 1024 / 1024).toFixed(2)
        }
        event.reply('cache-size', size);

      })
    });
    ipcMain.on('delete-cache', (event, items) => this.deleteCache(event, items));
    ipcMain.on('get-config', (event) => event.reply('config-data', this.config.getSettings()) );
    ipcMain.on('save-config', (event, data) => this.config.loadSettings(data) );

    /*-----------------------------------
    Check for update
    -----------------------------------*/
    ipcMain.on('check-for-update', (event) => {
      let configData = this.config.getSettings();
      if(configData.checkUpdates){
        Updater.check(configData).then(res => {
          if(!res){return}
          event.reply('need-to-update', res);
        }).catch(err => {
          console.log(clr.red(err));
          event.reply('show-error', err);
        })
      }
    });






  }

  /**
   * File server for thumps
   */
  startFileServer() {
    let app = express();

    app.use(cors());
    app.use(express.static(homedir + '/static'));
    let server = app.listen(0);

    this.serverUrl = `http://localhost:${server.address().port}/`;
    console.log(`Static file server run on:  ${this.serverUrl}`);
    this.win.webContents.send('start-file-server', this.serverUrl);

  }

  openDir(event) {
    let options = {
      properties: ['openDirectory']
    };

    let resOpen = dialog.showOpenDialogSync(options);
    if (!resOpen) {
      event.reply('open-dir', false);
      return
    }

    event.reply('open-dir', resOpen[0]);
    this.readDir(resOpen[0]);
    return resOpen
  }

  readDir(pathDir) {
    fs.readdir(pathDir, (err, files) => {

      //check path
      Helper.checkDir(this.static_dir + '/small/');
      Helper.checkDir(this.static_dir + '/big/');

      //filter files from not media
      let goodExt = ['jpg', 'jpeg', 'png', 'mp4'];

      files = files.filter(el => {
        let ext = el.split('.').pop().toLowerCase();
        return goodExt.indexOf(ext) !== -1;
      });

      if (!files.length) {
        this.win.webContents.send('open-dir', false);
        return
      }

      //send info about files count
      this.win.webContents.send('start-read-dir', files.length);

      //
      console.log(clr.xterm(115)('Start read dir...'));

      files.forEach(file => {
        let ext = file.split('.').pop().toLowerCase();
        let origPath = pathDir + '/' + file;

        switch (ext) {
          case 'mp4':
            Media.saveVideo(origPath, this.win);
            break;
          default:
            Media.saveImage(origPath, this.win);
        }
      });


    })


  }

  deleteSelected(dataArray) {
    dataArray.forEach(async item => {
      //thumb and symLink
      let thumpPath = this.static_dir + '/small/' + item.thumpName;
      let symlPath = this.static_dir + '/big/' + item.bigName;

      if (Helper.isFileExists(thumpPath)) {
        fs.unlink(thumpPath, (err) => {
          if (err) {
            this.win.webContents.send('delete-error', err);
            return;
          }
          console.log(`${thumpPath} was deleted`);
        });
      }
      if (Helper.isFileExists(symlPath)) {
        fs.unlink(symlPath, (err) => {
          if (err) {
            this.win.webContents.send('delete-error', err);
            return;
          }
          console.log(`${symlPath} was deleted`);
        });
      }

      //original
      if (Helper.isFileExists(item.origPath)) {
        let delRes = await trash(item.origPath, {glob: false});
        console.log(clr.magenta(`\nInfo about deleted original file '${item.origPath}'`));
        console.log(delRes);
      }

      this.win.webContents.send('file-deleted', item);

    });


    return true
  }

  deleteCache(event, items = []) {
    //if no items loaded delete static dir with all inside
    if(!items.length){
      if (Helper.isFileExists(this.static_dir)) {
        rimraf(this.static_dir, (err) => {
          if (err) {
            event.reply('delete-error', err);
            event.reply('delete-cache-finish', true);
            console.log(clr.red(`Error: ${err}`));
            return;
          }
        });
      }

      event.reply('delete-cache-finish', true);
      console.log(`Cache was deleted`);
      return;
    }

    //else. read and delete thump and links dir
    removeFilesHelper(path.join(this.static_dir, 'small'), items.map(i => i['thumpName']));
    removeFilesHelper(path.join(this.static_dir, 'big'), items.map(i => i['bigName']));
    event.reply('delete-cache-finish', true);
    console.log(`Cache was deleted`);

  }
}


function removeFilesHelper(dirPath, names){
  try{
    let res_of_read = fs.readdirSync(dirPath);

    res_of_read.forEach(filename => {
      let index = names.indexOf(filename),
          filePath = path.join(dirPath, filename);

      if(index === -1){
        fs.unlink(filePath, (err)=>{
          if(err){
            console.log(clr.red("Error: " + err));
          }
        })
      }
    })

  }catch (e) {
    console.log(e);
    //nothing do here, because it is mean that dir is not exists..
  }
}


export {MainModelClass, removeFilesHelper}
