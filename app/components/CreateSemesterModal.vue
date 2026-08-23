<script setup lang="ts">
  import { z } from 'zod'
  import type { FormSubmitEvent } from '@nuxt/ui'
  import { ACTION_ICONS } from '~/utils/icons'
  import type { SemesterCreate } from '#server/services/semesterService'

  const emit = defineEmits<{ close: [semester: SemesterCreate | null] }>()

  const seasons = [
    { label: 'Spring', value: 'SPRING' },
    { label: 'Summer', value: 'SUMMER' },
    { label: 'Fall', value: 'FALL' },
  ]

  const schema = z.object({
    season: z.enum(['SPRING', 'SUMMER', 'FALL']),
    year: z.number().int().min(2000).max(2100),
  })

  const state = reactive({
    season: 'FALL' as 'SPRING' | 'SUMMER' | 'FALL',
    year: new Date().getFullYear(),
  })

  function onSubmit(event: FormSubmitEvent<z.infer<typeof schema>>) {
    emit('close', event.data)
  }
</script>

<template>
  <UModal title="Add Semester" @close="emit('close', null)">
    <template #body>
      <UForm :schema="schema" :state="state" class="space-y-4" @submit="onSubmit">
        <UFormField label="Season" name="season">
          <URadioGroup v-model="state.season" orientation="horizontal" :items="seasons" />
        </UFormField>

        <UFormField label="Year" name="year">
          <UInputNumber v-model="state.year" class="w-full" />
        </UFormField>

        <div class="flex justify-end gap-2">
          <UButton
            label="Cancel"
            :icon="ACTION_ICONS.cancel"
            color="neutral"
            variant="soft"
            @click="emit('close', null)"
          />
          <UButton label="Confirm" :icon="ACTION_ICONS.confirm" type="submit" />
        </div>
      </UForm>
    </template>
  </UModal>
</template>
