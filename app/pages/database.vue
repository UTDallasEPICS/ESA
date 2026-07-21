<script setup lang="ts">
  const semesterId = ref<string | undefined>()

  const items = [
    { label: 'Projects', slot: 'projects' },
    { label: 'Students', slot: 'students' },
    { label: 'Partners', slot: 'partners' },
  ]
</script>

<template>
  <UContainer class="space-y-6 py-8">
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-bold">Database</h1>
      <SemesterFilter v-model="semesterId" />
    </div>

    <UTabs :items="items" class="w-full">
      <template #projects>
        <ProjectsTab :semester-id="semesterId" />
      </template>
      <template #students>
        <StudentsTab :semester-id="semesterId" />
      </template>
      <template #partners>
        <PartnersTab :semester-id="semesterId" />
      </template>
    </UTabs>
  </UContainer>
</template>
