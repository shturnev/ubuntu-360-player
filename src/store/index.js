import Vue from 'vue'
import Vuex from 'vuex'
import {shell} from 'electron'


Vue.use(Vuex)

export default new Vuex.Store({
  modules: {

  },
  state: {
    MS: null,
    can_select: false,
    can_open_dir: true,
    static_files_url: "",
    total_items: 0,
    open_settings: false,
  },
  getters: {

  },
  mutations: {
    set(state, data) {
      state[data[0]] = data[1]
    }
  },
  actions: {
    openExternalLink(context, link){
      shell.openExternal(link);
    },

  }
})
