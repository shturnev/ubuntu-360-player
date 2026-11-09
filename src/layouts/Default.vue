<template>
  <q-layout view="hHh lpR fFf">

    <HeaderComponent></HeaderComponent>
    <!--    <LeftMenuComponent></LeftMenuComponent>-->

    <q-page-container >
      <router-view />
    </q-page-container>

    <!--    <FooterComponent></FooterComponent>-->


  </q-layout>
</template>

<script>
  import FooterComponent from "../components/FooterComponent";
  import HeaderComponent from "../components/HeaderComponent";
  import LeftMenuComponent from "../components/LeftMenuComponent";
  import {ipcRenderer} from 'electron'

  export default {
    name: "default",
    components: {FooterComponent, HeaderComponent, LeftMenuComponent},
    data () {
      return {
        left: false
      }
    },
    created() {
      //todo продолжить здесь
      ipcRenderer.send('get-server-url', null);
      ipcRenderer.on('start-file-server', (ev, data) =>{
        this.$store.commit("set", ["static_files_url", data]);
        console.log(data);
      })


      // let MS = backend.MainStruct;
      // MS.GetUrlForStatic().then(res => this.$store.commit("set", ["static_files_url", res]))
      // this.$store.commit("set", ["MS", MS])
    }
  }
</script>

<style lang="scss">
  @import "../styles/sht-styles";

  body{
    background-color: $dark-grey;
  }
</style>