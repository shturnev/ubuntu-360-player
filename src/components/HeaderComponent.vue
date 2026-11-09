<template>
  <q-header elevated class="header-block text-grey-3" height-hint="98">
    <q-toolbar>

      <q-toolbar-title class="text-grey-7">
          <span class="text-caption">VR-PLAYER</span>
      </q-toolbar-title>

      <q-btn class="op-50" dense flat round icon="create_new_folder" :disable="!can_open_dir" @click="addDir">
        <q-tooltip>Add dir</q-tooltip>
      </q-btn>
      <q-btn v-if="total_items > 0"  :class="[can_select ? 'text-secondary' : 'op-50']" dense flat round icon="playlist_add_check" @click="can_select = !can_select">
        <q-tooltip>Select files</q-tooltip>
      </q-btn>
      <!--<q-btn class="op-50" dense flat round icon="add_photo_alternate" @click="">
        <q-tooltip>Add files</q-tooltip>
      </q-btn>-->

      <q-btn class="op-50" dense flat round icon="settings" @click="open_settings = !open_settings">
        <q-tooltip>Settings</q-tooltip>
      </q-btn>

      <div class="op-50 be-a-sponsor">
        <a href="" @click.prevent="openExternalLink('https://www.liqpay.ua/en/checkout/shtvrplayer')">
          <q-icon color="red" name="favorite" size="md" flat round dense />
          <span class="inline-block ml5">Donate!</span>
        </a>
      </div>


    </q-toolbar>

  </q-header>
</template>

<script>
  import {mapActions, mapState} from 'vuex'
  import {ipcRenderer} from 'electron'


  export default {
    name: "HeaderComponent",
    data(){
      return{

      }
    },
    computed: {
      can_select: {
        get(){
          return this.$store.state.can_select
        },
        set(val){
          this.$store.commit("set", ['can_select', val])
        },
      },
      open_settings: {
        get(){
          return this.$store.state.open_settings
        },
        set(val){
          if(val){ ipcRenderer.send('get-cache-size') }
          this.$store.commit("set", ['open_settings', val])
        },
      },
      ...mapState(['MS', 'can_open_dir', 'total_items'])
    },
    methods:{
      ...mapActions(['openExternalLink']),
      addDir(){
        ipcRenderer.send('open-dir', true);
      },
      /*openExternalLink(link){
        shell.openExternal(link);
      }*/
    },
    created() {
      // console.log(electron);
    }
  }
</script>

<style scoped lang="scss">
  @import "../styles/sht-styles";

  .header-block {
    background-color: darken($dark-grey, 5%);
  }

  .be-a-sponsor{
    overflow-x: hidden;
    width: 31px;
    transition: .3s ease all;
    filter: grayscale(1);
    transform: scale(0.8);
    animation: pulse 3s ease-out infinite;
    margin-left: 5px;

    a{
      white-space: nowrap;
      text-decoration: none;

      span{
        color: white;
        font-size: 16px;
      }
    }

    &:hover{
      transform: scale(1);
      filter: grayscale(0);
      width: 93px;
      animation: none;
    }
  }


  @keyframes pulse {
    from {
      transform: scale(0.8);
      filter: grayscale(1);

    }
    to{
      transform: scale(0.88);
      filter: grayscale(.3);

    }
  }
</style>
