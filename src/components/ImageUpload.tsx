'use client';

import { useState } from 'react';

/**
 * File input that downsizes images in the browser (max 1600px, JPEG) before the form is
 * submitted, so photos from phones stay small enough to store in the database.
 * The resized file is placed in a hidden input named `name`.
 */
export function ImageUpload({ name = 'photo', label = 'Photo' }: { name?: string; label?: string }) {
  const [preview, setPreview] = useState<string | null>(null);

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.currentTarget;
    const file = input.files?.[0];
    if (!file) { setPreview(null); return; }
    if (!file.type.startsWith('image/')) return; // PDFs etc. are sent as-is
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob: Blob = await new Promise((r) => canvas.toBlob((b) => r(b!), 'image/jpeg', 0.8));
    const resized = new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
    const dt = new DataTransfer();
    dt.items.add(resized);
    input.files = dt.files;
    setPreview(URL.createObjectURL(resized));
  }

  return (
    <div>
      <span className="label">{label}</span>
      <input type="file" name={name} accept="image/*,application/pdf" onChange={onChange} className="block w-full text-sm" />
      {preview && <img src={preview} alt="" className="mt-2 h-24 rounded border object-cover" />}
    </div>
  );
}
