<template>
  <q-page class="q-pa-md">

    <!--BIG + button-->
    <div v-if="!items.length" class="big-plus-cont">
      <q-btn
        @click="addDir"
        class="op-50"
        size="35px"
        round
        flat
        :disable="!can_open_dir"
        text-color="grey-5"
        icon="create_new_folder"
      />
    </div>

    <q-slide-transition>
      <div v-if="can_select" class="select_menu">
        <q-card dark class="bg-darken">
          <q-card-section class="row items-center no-wrap">
            <div>
              <div>Selected {{total_selected}} from {{items.length}}</div>
            </div>

            <q-space/>

            <q-btn flat round icon="done_all" @click="toggleSelectionAll(!total_selected)">
              <q-tooltip>{{total_selected ? 'un' : ''}}select all</q-tooltip>
            </q-btn>

            <q-btn :disable="total_selected === 0" flat round icon="clear_all" @click="clearSelected()">
              <q-tooltip>Clear selected</q-tooltip>
            </q-btn>
            <q-btn @click="beforeDelete()" :disable="total_selected === 0" flat round icon="delete"/>
            <q-btn flat round icon="close" @click="() => {can_select = !can_select; toggleSelectionAll(false) }"/>
          </q-card-section>
        </q-card>
      </div>
    </q-slide-transition>


    <!--size slider and dir info-->
    <div v-if="items.length" class="flex items-center">
      <div class="self-start text-grey-8">
        {{selected_path}} - ({{items.length}} files)
      </div>
      <q-space/>
      <div style="width: 135px;" class="op-50">
        <q-slider v-model="max_size_px" :min="100" :max="435" color="secondary"/>
      </div>

    </div>

    <!--progress-->
    <div class="column q-mb-lg" v-if="loadingProgress.show">
      <div class=" text-secondary">
        {{ loadingProgress.complete === 0 || loadingProgress.complete !== loadingProgress.total ?
        `Loading... ${loadingProgress.complete} / ${loadingProgress.total}` : `Completed!`}}
      </div>
      <q-linear-progress dark
                         :value="loadingProgress.complete === 0 ? 0 : loadingProgress.complete / loadingProgress.total"
                         color="secondary"/>
    </div>

    <!--List items-->
    <ul v-if="items.length"
        class="ul-media-list" :style="`grid-template-columns: repeat(auto-fill, minmax(${max_size_px}px, 1fr))`">
      <li v-for="(item, index) in items" :class="{selected: item.selected}">
        <div
          @click="can_select ? toggleSelection(item, index) : showItem(item, index)"
          class="media-item" :style="`height:${max_size_px * (224 / 450)}px`">
          <div class="photo"
               :style="`
                background: url(${static_files_url}small/${item.thumpName}) no-repeat center / contain;`">

            <div class="is-video" v-if="item.type === 'video'">
              <q-icon name="play_circle_filled" class="" color="grey-4" size="md"></q-icon>
            </div>
          </div>

          <div class="controls bg-secondary">
            <q-icon class="check-icon" name="check" color="white" size="sm"></q-icon>
          </div>
        </div>
      </li>
    </ul>

    <!--open media item-->
    <div class="opened-media-cont column" v-if="Object.keys(showingItem).length">
      <Pano :type="showingItem.type" :source="`${static_files_url}big/${showingItem.bigName}`"/>
      <div class="head-actions">
        <q-btn
          @click="showingItem ={}"
          class="op-50" flat color="grey-7" text-color="grey-4" icon="close" size="20px"/>
      </div>
      <div
        v-if="items[showingItem.index - 1]"
        class="op-50" style="position: absolute;left: 0; top: calc(50% - 25px);">
        <q-btn
          @click="showItem(items[showingItem.index - 1], showingItem.index - 1)"
          size="28px" flat color="grey-7" text-color="grey-4" icon="arrow_back_ios"/>
      </div>
      <div
        v-if="items[showingItem.index + 1]"
        class="op-50" style="position: absolute;right: 0; top: calc(50% - 25px);">
        <q-btn
          @click="showItem(items[showingItem.index + 1], showingItem.index + 1)"
          size="28px" flat color="grey-7" text-color="grey-4" icon="arrow_forward_ios"/>
      </div>
      <div class="bottom-actions">
        <q-icon @click="beforeDelete(showingItem)" class="btn" name="delete_outline" color="white" size="27px"/>
      </div>
    </div>

    <!--settings modal-->
    <q-dialog v-model="open_settings">
      <q-card style="min-width: 360px;">
        <q-card-section class="row items-center ">
          <div class="text-h6">Settings</div>
          <!--<q-space />
          <q-btn icon="close" flat round dense v-close-popup />-->
        </q-card-section>

        <q-card-section>
          <q-list separator>

            <q-item clickable @click="deleteCache()">
              <q-item-section>Clear data cache</q-item-section>
              <q-item-section side>
                <b>{{cacheSize}} MB</b>
              </q-item-section>
            </q-item>

            <q-item v-if="configData" clickable @click="set_checkUpdates">
              <q-item-section>Check for updates</q-item-section>
              <q-item-section side>
                <q-toggle color="secondary" @input="set_checkUpdates" :value="configData.checkUpdates"/>
              </q-item-section>
            </q-item>
          </q-list>

          <q-separator class="q-my-md"/>

          <div class="text-center">
            <p>Please donate to the project! This will help me continue to work on it and add improvements! Thanks!</p>

            <q-btn @click="openExternalLink('https://www.liqpay.ua/en/checkout/shtvrplayer')">
              <q-icon color="red" name="favorite"/>
              &nbsp;Donate!
            </q-btn>
          </div>
          <br>

          <div class="text-center">
            v{{configData.version}}
            <a class="text-secondary" href=""
               @click.prevent="openExternalLink('https://gitlab.com/go-apps-XnjRcS/vr-viewer-for-linux/electron-version/-/blob/master/CHANGELOG.md')">see
              the list of changes</a>.

            <br>
            Created by
            <a class="text-secondary" href=""
               @click.prevent="openExternalLink('https://www.facebook.com/sergey.shturnev')">
              Shturnev Sergey</a>

          </div>


        </q-card-section>
      </q-card>
    </q-dialog>

  </q-page>
</template>

<script>
  import {Pano} from 'vuejs-vr'
  import {mapActions, mapState} from 'vuex'
  import {ipcRenderer,} from 'electron'
  import _ from 'lodash'


  export default {
    name: 'Home',
    components: {Pano},
    data() {
      return {
        selected_path: "",
        items: [],
        max_size_px: 150,
        selected: [],
        loadingProgress: {
          show: false,
          total: 0,
          complete: 0,
        },
        showingItemDialog: false,
        showingItem: {},
        cacheSize: 0,
        deleteCacheloading: false,
        configData: {}
      }
    },
    computed: {
      ...mapState([
        'static_files_url',
        'can_open_dir',
        'total_items',
      ]),
      total_selected() {
        return this.items.filter(item => item.selected).length
      },
      can_select: {

        get() {
          return this.$store.state.can_select
        },
        set(val) {
          this.$store.commit("set", ['can_select', val])
        }
      },
      open_settings: {
        get() {
          return this.$store.state.open_settings
        },
        set(val) {
          this.$store.commit("set", ['open_settings', val])
        },
      },
      ttest() {
        return this.configData.checkUpdates
      }
    },
    watch: {
      /*'can_select'(newVal, oldVal) {
        console.log(newVal)
      }*/
    },
    methods: {
      ...mapActions(['openExternalLink']),
      whenDirIsOpen(ev, data) {
        if (!data) {
          this.$store.commit("set", ["can_open_dir", true]);
        } else {
          this.$store.commit("set", ["can_open_dir", false]);
          this.selected_path = data;
        }

      },
      startReadDir(ev, total) {
        this.loadingProgress = {
          show: true,
          total,
          complete: 0,
        }
        this.items = [];
      },
      finishReadDir() {
        setTimeout(() => {
          this.loadingProgress.show = false
          this.$store.commit("set", ["can_open_dir", true])
        }, 600)

      },
      readFile(event, data) {
        this.loadingProgress.complete += 1;
        if (this.loadingProgress.complete === this.loadingProgress.total) {
          this.finishReadDir()
        }

        if (data.error) {
          this.$q.notify({
            message: data.error.message,
            color: 'negative',
          });
          return
        }

        let tmp = _.cloneDeep(this.items);
        tmp.push(data);
        tmp = _.sortBy(tmp, ['thumpName']);
        this.items = tmp;
        this.$store.commit('set', ['total_items', this.items.length]);

      },
      addDir() {
        ipcRenderer.send('open-dir', true);
      },
      showItem(item, index) {
        this.showingItem = {
          ...item,
          index
        }
      },
      toggleSelection(item, index) {
        this.$set(this.items[index], 'selected', !item.selected)
      },
      toggleSelectionAll(status) {
        // let status = this.total_selected > 0;

        this.items.forEach((item, index) => {
          this.$set(this.items[index], 'selected', status)
        })
      },
      clearSelected() {
        this.items = this.items.filter(item => !item.selected);
      },
      beforeDelete(item = null) {
        if (item) {
          this.toggleSelection(this.items[item.index], item.index)
        }

        this.$q.dialog({
          title: 'Delete?',
          message: `Would you like to delete
                    ${this.total_selected > 1 ? 'these (' + this.total_selected + ') files' : 'this file'}`,
          cancel: true,
          persistent: true,
          dark: true,
          color: 'white'
        }).onOk(() => {
          if (item) {
            if (this.items[item.index + 1]) {
              this.showItem(this.items[item.index + 1], item.index + 1)
            } else if (this.items[item.index - 1]) {
              this.showItem(this.items[item.index - 1], item.index - 1)
            } else {
              this.showingItem = {}
            }
          }

          this.deleteFiles()
        }).onCancel(() => {
          if(item){
            this.toggleSelection(this.items[item.index], item.index)
          }
        })
      },
      deleteFiles() {
        let selectedItems = this.items.filter(item => item.selected);
        ipcRenderer.send('delete-selected', selectedItems);
      },
      whenDeleted(ev, item) {
        let index = _.findIndex(this.items, item);
        this.items.splice(index, 1);
      },
      deleteCache() {
        this.deleteCacheloading = true;
        ipcRenderer.send('delete-cache', this.items)
      },
      set_checkUpdates() {
        let data = this.configData;
        data.checkUpdates = !data.checkUpdates;
        ipcRenderer.send('save-config', data)

        if (data.checkUpdates) {
          ipcRenderer.send('check-for-update', null);
        }
      },
    },
    created() {

      ipcRenderer.send('get-config', null);
      ipcRenderer.send('check-for-update', null);


      ipcRenderer.on('config-data', (ev, data) => {
        this.configData = data;
        // this.$store.commit("set", ['configData', data])
        // console.log(this.configData);
      });


      ipcRenderer.on('open-dir', this.whenDirIsOpen);
      ipcRenderer.on('start-read-dir', this.startReadDir);
      ipcRenderer.on('read-media-file', this.readFile);
      ipcRenderer.on('file-deleted', this.whenDeleted);
      ipcRenderer.on('delete-error', (ev, err) => {
        console.log(err, ev);
        this.$q.notify({
          message: `${err.syscall} <br> ${err.code} <br> ${err.path}`,
          html: true,
          color: 'negative',
        });
      });
      ipcRenderer.on('cache-size', (ev, data) => {
        this.cacheSize = data
      });
      ipcRenderer.on('delete-cache-finish', () => {
        this.deleteCacheloading = false;
        ipcRenderer.send('get-cache-size')
      });

      /*-----------------------------------
      Updates
      -----------------------------------*/
      ipcRenderer.on('need-to-update', (ev, data) => {
        let dlink = this.configData.downloadLink + data.hash;
        let ver = data.filename_orig.split("_")[1];

        this.$q.notify({
          message: `<div class="text-subtitle1">New version released <b>v${ver}</b></div>
                    <div class="">Installed v${this.configData.version}</div>`,
          multiLine: true,
          html: true,
          timeout: 0,
          progress: true,
          // color: 'secondary',
          actions: [
            {
              label: 'Download', color: 'yellow', handler: () => {
                this.$store.dispatch("openExternalLink", dlink)
              }
            },
            {
              label: 'Dismiss', color: 'white', handler: () => {
              }
            }
          ]
        });
      });

    }
  }
</script>
<style scoped lang="scss">
  @import "../styles/sht-styles";

  .bg-dark {
    background-color: $dark-grey;
  }

  .bg-darken {
    background-color: darken($dark-grey, 5%);
  }

  .select_menu {
    position: fixed;
    top: 0;
    right: 0;
    left: 0;
    z-index: 6000;
  }


  .ul-media-list {
    list-style: none;
    margin: 25px 0;
    padding: 0;
    display: grid;
    grid-gap: 10px;
    /*grid-template-columns: repeat(auto-fill, minmax(50px, 300px));*/

    & > li {
      border: 2px solid transparent;
      padding: 5px;
      overflow: hidden;

      &:hover {
        border-color: rgba($secondary, .5);
      }

      & > .media-item {
        display: flex;
        justify-content: center;
        align-items: center;
        position: relative;
        cursor: pointer;
        /*transition: all .2s ease;*/


        & > .photo {
          position: absolute;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 100%;
          height: 100%;
          box-sizing: border-box;

        }

        & > .controls {
          display: none;
          position: absolute;
          right: -5px;
          top: -5px;
          /*transform: rotate(45deg);*/


          .check-icon {
            position: relative;
            /*<!--transform: rotate(-45deg) translate(-18px, 18px);-->*/
          }
        }

      }

      &.selected {
        border-color: rgba($secondary, .5);

        .controls {
          display: block;
        }
      }


    }
  }

  .big-plus-cont {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .opened-media-cont {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: #1cff1b;
    z-index: 2001;

    & > .head-actions {
      position: absolute;
      right: 0;
      top: 0;
    }

    & > .bottom-actions {
      display: flex;
      position: absolute;
      bottom: 8px;
      right: 97px;

      & > .btn {
        &:hover {
          cursor: pointer;
          filter: drop-shadow(white 0 0 5px);
        }
      }
    }


  }
</style>
