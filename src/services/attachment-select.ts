export const attachmentUserSelect = { id: true, displayName: true, role: true } as const;

export const attachmentSelect = {
  id: true,
  fileName: true,
  mimeType: true,
  sizeBytes: true,
  createdAt: true,
  uploadedBy: { select: attachmentUserSelect },
} as const;
