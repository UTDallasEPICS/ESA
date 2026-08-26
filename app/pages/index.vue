<script setup lang="ts">
  import { authClient } from '../utils/auth-client'

  const selectedFile = ref<File | null>(null)
  const imagePreview = ref<string>('')
  const isUploading = ref(false)
  const isModalOpen = ref(false)

  async function logout() {
    await authClient.signOut()
    await navigateTo('/auth', { external: true })
  }

  function handleImageUpload(event: Event) {
    const target = event.target as HTMLInputElement
    const files = target.files as FileList

    if (!files || files.length === 0) return

    const file = files[0]

    if (!file?.type.startsWith('image/')) {
      return
    }

    selectedFile.value = file

    const reader = new FileReader()
    reader.onload = (e) => {
      imagePreview.value = e.target?.result as string
    }
    reader.readAsDataURL(file)
  }

  const openModal = () => {
    isModalOpen.value = true
  }

  const closeModal = () => {
    isModalOpen.value = false
  }

  async function updatePfp() {
    if (!selectedFile.value) return

    isUploading.value = true

    try {
      const formData = new FormData()
      formData.append('file', selectedFile.value)

      await $fetch('/api/users/upload', {
        method: 'POST',
        body: formData,
      })

      // Refresh users data to show updated profile picture
      await refreshNuxtData()

      // Reset state
      selectedFile.value = null
      imagePreview.value = ''
      isModalOpen.value = false
    } catch (error) {
      console.error('Upload failed:', error)
    } finally {
      isUploading.value = false
    }
  }
</script>

<template>
  <UContainer class="py-10">
    <div class="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-center">
      <div>
        <h1 class="text-3xl font-bold tracking-tight text-gray-900 dark:text-white">Dashboard</h1>
        <p class="mt-1 text-gray-500 dark:text-gray-400">Manage your account settings.</p>
      </div>
      <div class="flex justify-between gap-4 md:items-center">
        <UModal :open="isModalOpen">
          <UButton
            color="success"
            variant="soft"
            @click="openModal"
            icon="i-heroicons-arrow-up-on-square-20-solid"
            label="Update Profile Picture"
          />

          <template #content>
            <div class="m-12 space-y-4">
              <h3 class="text-lg font-medium text-gray-900 dark:text-white">
                Update Profile Picture
              </h3>

              <div v-if="imagePreview" class="flex justify-center">
                <UAvatar :src="imagePreview" size="3xl" />
              </div>

              <div>
                <input
                  type="file"
                  accept="image/*"
                  class="file:bg-primary-50 file:text-brand4 hover:file:bg-primary-100 block w-full cursor-pointer text-sm text-gray-500 file:mr-4 file:rounded-full file:border-0 file:px-4 file:py-2 file:text-sm file:font-semibold"
                  @change="handleImageUpload"
                />
              </div>

              <div class="flex justify-end gap-2">
                <UButton variant="soft" @click="closeModal"> Cancel </UButton>
                <UButton
                  color="success"
                  :loading="isUploading"
                  :disabled="!selectedFile"
                  @click="updatePfp"
                >
                  Upload
                </UButton>
              </div>
            </div>
          </template>
        </UModal>
        <UButton
          color="error"
          variant="soft"
          icon="i-heroicons-arrow-right-on-rectangle-20-solid"
          label="Logout"
          @click="logout"
        />
      </div>
    </div>
  </UContainer>
</template>
