<script setup lang="ts">
  const semesterId = ref<string | undefined>()

  const items = [
    { label: 'Projects', slot: 'projects' },
    { label: 'Students', slot: 'students' },
    { label: 'Partners', slot: 'partners' },
  ]

  // A tab that still holds staged changes when the filter moves asks the user first, and puts the
  // previous semester back if they decline (§2.3.2).
  function restoreSemester(previous: string | undefined) {
    semesterId.value = previous
  }
</script>

<template>
  <UContainer class="space-y-6 py-8">
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-bold">Database</h1>
      <SemesterFilter v-model="semesterId" />
    </div>

    <UTabs :items="items" class="w-full">
      <template #projects>
        <ProjectsTab :semester-id="semesterId" @restore-semester="restoreSemester" />
      </template>
      <template #students>
        <StudentsTab :semester-id="semesterId" @restore-semester="restoreSemester" />
      </template>
      <template #partners>
        <PartnersTab :semester-id="semesterId" @restore-semester="restoreSemester" />
      </template>
    </UTabs>
  </UContainer>
</template>
