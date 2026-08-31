import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type StoredFile = { body: Buffer; contentType: string };

export interface StorageService {
  upload(path: string, file: StoredFile): Promise<void>;
  download(path: string): Promise<StoredFile>;
  remove(path: string): Promise<void>;
  createSignedUrl(path: string, expiresInSeconds: number): Promise<string>;
}

export class SupabaseStorageService implements StorageService {
  private readonly client: SupabaseClient;

  constructor(url: string, secretKey: string, private readonly bucket: string) {
    this.client = createClient(url, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }

  async upload(path: string, file: StoredFile): Promise<void> {
    const { error } = await this.client.storage.from(this.bucket).upload(path, file.body, {
      contentType: file.contentType,
      upsert: false,
    });
    if (error) throw new Error(`Storage upload failed: ${error.message}`);
  }

  async download(path: string): Promise<StoredFile> {
    const { data, error } = await this.client.storage.from(this.bucket).download(path);
    if (error || !data) throw new Error(`Storage download failed: ${error?.message ?? "object unavailable"}`);
    return { body: Buffer.from(await data.arrayBuffer()), contentType: data.type || "application/octet-stream" };
  }

  async remove(path: string): Promise<void> {
    const { data, error } = await this.client.storage.from(this.bucket).remove([path]);
    if (error || !data?.length) throw new Error(`Storage delete failed: ${error?.message ?? "object unavailable"}`);
  }

  async createSignedUrl(path: string, expiresInSeconds: number): Promise<string> {
    const { data, error } = await this.client.storage.from(this.bucket).createSignedUrl(path, expiresInSeconds);
    if (error || !data?.signedUrl) throw new Error(`Signed URL creation failed: ${error?.message ?? "object unavailable"}`);
    return data.signedUrl;
  }
}
