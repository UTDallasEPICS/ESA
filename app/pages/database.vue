<script setup lang="ts">
  // The page owns the semester filter and the active tab, and gates both: a tab holding staged
  // changes is asked before either moves. Switching tabs matters as much as switching semester —
  // UTabs unmounts the inactive panel, which would take its staged work with it silently (§2.3.2).
  import { provideSemesterFilter } from '~/composables/useSemesterFilter'

  const { semesterId, request, confirmDiscard } = provideSemesterFilter()

  const items = [
    { label: 'Projects', value: 'projects', slot: 'projects' as const },
    { label: 'Students', value: 'students', slot: 'students' as const },
    { label: 'Partners', value: 'partners', slot: 'partners' as const },
  ]

  const activeTab = ref('projects')

  async function setTab(next: any) {
    const value = String(next)
    if (value === activeTab.value) return
    if (await confirmDiscard('Switching tabs will discard everything you have staged here.')) {
      activeTab.value = value
    }
  }
</script>

<template>
  <UContainer class="space-y-6 py-8">
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-bold">Database</h1>
      <SemesterFilter :model-value="semesterId" @update:model-value="request" />
    </div>

    <UTabs :items="items" :model-value="activeTab" class="w-full" @update:model-value="setTab">
      <template #projects><ProjectsTab /></template>
      <template #students><StudentsTab /></template>
      <template #partners><PartnersTab /></template>
    </UTabs>
  </UContainer>
</template>
