<script setup lang="ts">
  import ModalFooter from '~/components/modals/ModalFooter.vue'
  import { z } from 'zod'
  import type { FormSubmitEvent } from '@nuxt/ui'
  import { MEETING_DAY_OPTIONS, type SelectOption } from '~/utils/options'

  import type { TeamDraft } from '~/utils/recordDrafts'

  const props = defineProps<{
    /** Only semesters the project does not already hold a team for (§3.1.4). */
    semesters: SelectOption[]
    defaultSemesterId?: string
  }>()

  const emit = defineEmits<{ close: [team: TeamDraft | null] }>()

  const schema = z.object({
    semesterId: z.string().min(1),
    meetingDay: z.enum(['WEDNESDAY', 'THURSDAY']),
  })

  const state = reactive<TeamDraft>({
    semesterId: props.defaultSemesterId ?? '',
    meetingDay: 'WEDNESDAY',
  })

  function onSubmit(event: FormSubmitEvent<z.infer<typeof schema>>) {
    emit('close', event.data)
  }
</script>

<template>
  <UModal title="Add Team" @close="emit('close', null)">
    <template #body>
      <UForm :schema="schema" :state="state" class="space-y-4" @submit="onSubmit">
        <UFormField label="Semester" name="semesterId">
          <USelectMenu
            v-model="state.semesterId"
            :items="props.semesters"
            value-key="value"
            class="w-full"
          />
        </UFormField>
        <UFormField label="Meeting Day" name="meetingDay">
          <URadioGroup
            v-model="state.meetingDay"
            orientation="horizontal"
            :items="MEETING_DAY_OPTIONS"
          />
        </UFormField>
        <ModalFooter submit @cancel="emit('close', null)" />
      </UForm>
    </template>
  </UModal>
</template>
