import { supabase } from "../supabase";
import AsyncStorage from "@react-native-async-storage/async-storage";

const INSPEKSI_OFFLINE_KEY = "@offline_inspeksi_tph";

// Menyimpan hasil inspeksi TPH secara luring atau langsung ke server jika sinyal tersedia.
export const submitInspeksi = async (data, isConnected) => {
  const payload = {
    ...data,
    penalti_helper: data.tph_brondolan_lebih_nol * 2000,
    created_at: new Date().toISOString(),
  };

  if (!isConnected) {
    try {
      const existing = await AsyncStorage.getItem(INSPEKSI_OFFLINE_KEY);
      const queue = existing ? JSON.parse(existing) : [];
      queue.push(payload);
      await AsyncStorage.setItem(INSPEKSI_OFFLINE_KEY, JSON.stringify(queue));
      return { success: true, mode: "offline" };
    } catch (e) {
      return { success: false, error: "Gagal simpan lokal" };
    }
  }

  const { error } = await supabase.from("inspeksi_tph").insert([payload]);
  if (error) return { success: false, error: error.message };
  return { success: true, mode: "online" };
};

// Mengirimkan data inspeksi yang tertunda saat koneksi internet kembali stabil.
export const syncInspeksiOffline = async () => {
  try {
    const existing = await AsyncStorage.getItem(INSPEKSI_OFFLINE_KEY);
    if (!existing) return;
    const queue = JSON.parse(existing);
    if (queue.length === 0) return;

    for (const payload of queue) {
      await supabase.from("inspeksi_tph").insert([payload]);
    }
    await AsyncStorage.removeItem(INSPEKSI_OFFLINE_KEY);
  } catch (e) {
    console.error("Gagal sinkronisasi inspeksi", e);
  }
};
