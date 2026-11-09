<template>
  <q-drawer show-if-above v-model="left" side="left" bordered>
    <!-- drawer content -->
  </q-drawer>
</template>

<script>
  export default {
    name: "LeftMenuComponent",
    data() {
      return {
        left: false
      }
    }
  }
</script>

<style scoped>

</style>