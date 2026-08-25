<script setup lang="ts" generic="T extends Record<string, any>">
  const props = defineProps<{
    search: (query: string) => Promise<T[]>
    displayLabel: (item: T) => string
    placeholder?: string
    disabled?: boolean
    highlight?: boolean
    color?: string
  }>()

  const modelValue = defineModel<T | undefined>()

  const searchTerm = ref('')
  const results = ref<T[]>([])
  const loading = ref(false)

  const items = computed(() =>
    results.value.map((item) => ({ label: props.displayLabel(item), record: item }))
  )

  let searchToken = 0
  watch(searchTerm, async (query) => {
    const token = ++searchToken
    loading.value = true
    const found = await props.search(query)
    if (token === searchToken) {
      results.value = found
      loading.value = false
    }
  })

  const selectedItem = computed(() =>
    modelValue.value
      ? { label: props.displayLabel(modelValue.value), record: modelValue.value }
      : undefined
  )
</script>

<template>
  <USelectMenu
    :model-value="selectedItem"
    v-model:search-term="searchTerm"
    :items="items"
    :loading="loading"
    ignore-filter
    :disabled="disabled"
    :highlight="highlight"
    :color="color as any"
    :placeholder="placeholder ?? 'Search…'"
    @update:model-value="(v: any) => (modelValue = v?.record)"
  />
</template>
