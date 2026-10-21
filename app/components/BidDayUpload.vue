<script setup lang="ts">
  import { parseCsv, validateBidRows, type BidRowError } from '~/utils/bidCsv'
  import { titleCase } from '~/utils/labels'

  const props = defineProps<{
    semesterId?: string
    meetingDay: 'WEDNESDAY' | 'THURSDAY'
    /** Students with bids already saved for this semester/day. */
    savedCount: number
  }>()
  const emit = defineEmits<{ imported: [] }>()

  const bidFile = ref<File | null>(null)
  const parsedRows = ref<Record<string, string>[]>([])
  const parseErrors = ref<BidRowError[]>([])
  const missingColumns = ref<string[]>([])
  const uploadResult = ref<{
    studentsImported: number
    choicesCreated: number
    skippedStudents: string[]
    noBidPlacements: { name: string; netID: string; major: string; projectName: string }[]
    noBidUnplaced: string[]
  } | null>(null)
  const uploading = ref(false)
  const uploadError = ref<string | null>(null)

  watch(bidFile, async (file, _, onCleanup) => {
    let cancelled = false
    onCleanup(() => {
      cancelled = true
    })
    parsedRows.value = []
    parseErrors.value = []
    missingColumns.value = []
    if (!file) return

    // Only clear prior results once a new file is actually chosen, so a successful
    // upload's summary stays visible after we reset `bidFile` below.
    uploadResult.value = null
    uploadError.value = null

    let text: string
    try {
      text = await file.text()
    } catch {
      if (!cancelled) uploadError.value = 'Could not read this CSV. Please choose it again.'
      return
    }
    if (cancelled) return
    const rows = parseCsv(text)
    const validation = validateBidRows(rows)
    missingColumns.value = validation.missingColumns
    parseErrors.value = validation.errors
    if (!validation.missingColumns.length && !validation.errors.length) {
      parsedRows.value = rows
    }
  })

  // Once bids are saved for this semester/day the upload box is tucked away behind
  // "Replace bid file", since the usual visit has nothing to upload. With nothing
  // saved yet it's the whole card.
  const replacing = ref(false)
  const showUpload = computed(() => !props.savedCount || replacing.value)

  function cancelReplace() {
    replacing.value = false
    bidFile.value = null
  }

  const canUpload = computed(
    () =>
      !!props.semesterId &&
      parsedRows.value.length > 0 &&
      !parseErrors.value.length &&
      !missingColumns.value.length
  )

  async function submitBidFile() {
    if (!canUpload.value || uploading.value || !props.semesterId) return
    uploading.value = true
    uploadError.value = null
    try {
      uploadResult.value = await $fetch('/api/team-formation/bids', {
        method: 'POST',
        query: { semesterId: props.semesterId, meetingDay: props.meetingDay },
        body: parsedRows.value,
      })
      // Require a fresh selection before importing this roster again.
      bidFile.value = null
      replacing.value = false
      emit('imported')
    } catch (e: any) {
      uploadError.value = e?.data?.message ?? e?.message ?? 'Failed to import bid file.'
    } finally {
      uploading.value = false
    }
  }
</script>

<template>
  <div class="space-y-3 rounded-lg border border-gray-200 p-4 dark:border-gray-800">
    <h3 class="font-medium">{{ titleCase(meetingDay) }}</h3>

    <div v-if="!showUpload" class="flex flex-wrap items-center justify-between gap-2">
      <p class="text-sm">Bids from {{ savedCount }} student(s) are saved.</p>
      <UButton
        label="Replace bid file"
        icon="i-heroicons-arrow-path"
        size="xs"
        color="neutral"
        variant="ghost"
        @click="replacing = true"
      />
    </div>

    <template v-if="showUpload">
    <div v-if="replacing" class="space-y-2">
      <UAlert
        color="warning"
        variant="subtle"
        title="Replacing the bid file"
        description="Students in the new file get their details updated and their choices replaced. Students not in the file are kept as they are. Teams that already exist won't change until you generate again."
      />
      <UButton label="Cancel" size="xs" color="neutral" variant="ghost" @click="cancelReplace" />
    </div>

    <UFormField :label="`${titleCase(meetingDay)} Bid Response CSV`">
      <UFileUpload
        v-model="bidFile"
        accept=".csv"
        label="Drop CSV here or click to browse"
        :disabled="!semesterId || uploading"
      />
    </UFormField>
    <p v-if="!semesterId" class="text-sm text-gray-500">Select a semester above first.</p>

    <UAlert
      v-if="missingColumns.length"
      color="error"
      variant="subtle"
      title="Missing required columns"
      :description="missingColumns.join(', ')"
    />

    <div v-else-if="parseErrors.length" class="space-y-2">
      <UAlert
        color="error"
        variant="subtle"
        :title="`${parseErrors.length} error(s) found. Upload aborted.`"
      />
      <ul class="max-h-64 space-y-1 overflow-y-auto text-sm">
        <li v-for="(err, i) in parseErrors" :key="i" class="text-red-600 dark:text-red-400">
          Row {{ err.row }}: {{ err.message }}
        </li>
      </ul>
    </div>

    <UAlert
      v-else-if="parsedRows.length"
      color="success"
      variant="subtle"
      :title="`${parsedRows.length} row(s) validated successfully`"
    />

    <UButton
      :label="`Upload ${titleCase(meetingDay)} CSV`"
      icon="i-heroicons-arrow-up-tray"
      :loading="uploading"
      :disabled="!canUpload || uploading"
      @click="submitBidFile"
    />

    <UAlert
      v-if="uploadError"
      color="error"
      variant="subtle"
      title="Upload failed"
      :description="uploadError"
    />
    </template>

    <div v-if="uploadResult" class="space-y-2">
      <UAlert
        color="success"
        variant="subtle"
        title="Import complete"
        :description="`${uploadResult.studentsImported} student(s) imported, ${uploadResult.choicesCreated} choice(s) recorded.`"
      />
      <UAlert
        v-if="uploadResult.skippedStudents.length"
        color="warning"
        variant="subtle"
        title="Skipped rows (no SSO ID and no name)"
        :description="uploadResult.skippedStudents.join(', ')"
      />

      <div v-if="uploadResult.noBidPlacements.length" class="space-y-2">
        <UAlert
          color="info"
          variant="subtle"
          :title="`${uploadResult.noBidPlacements.length} student(s) had no bid and were placed by major`"
        />
        <ul class="space-y-1 text-sm">
          <li
            v-for="p in uploadResult.noBidPlacements"
            :key="p.netID"
            class="flex items-center justify-between rounded border border-gray-200 p-2 dark:border-gray-800"
          >
            <span>{{ p.name }} <span class="text-gray-500">({{ p.major }})</span></span>
            <span class="text-gray-500">→ {{ p.projectName }}</span>
          </li>
        </ul>
      </div>
      <UAlert
        v-if="uploadResult.noBidUnplaced.length"
        color="warning"
        variant="subtle"
        title="No-bid students imported but not placed (no teams for this semester/day yet)"
        :description="uploadResult.noBidUnplaced.join(', ')"
      />
    </div>
  </div>
</template>
