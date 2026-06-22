import { supabase } from "../supabase";
import { decode } from "base64-arraybuffer";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system";

const OFFLINE_STORAGE_KEY = "@offline_orders_queue";

// Mengalkulasi metrik operasional harian supir untuk memantau beban kerja dan kompensasi.
export const calculateTodayStats = async (userId) => {
  const { data: blokData } = await supabase
    .from("afdeling_blok")
    .select("afdeling, blok, jarak_km");

  const distanceMap = {};
  if (blokData) {
    blokData.forEach(
      (b) =>
        (distanceMap[
          `${b.afdeling.trim().toUpperCase()}_${b.blok.trim().toUpperCase()}`
        ] = Number(b.jarak_km)),
    );
  }

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const { data: rits } = await supabase
    .from("orders")
    .select("afdeling, blok, tonase_aktual, completed_at")
    .eq("driver_id", userId)
    .eq("status", "completed")
    .gte("completed_at", startOfDay.toISOString())
    .order("completed_at", { ascending: true });

  let akumulasiHK = 0;
  let totalPremi = 0;
  let totalGajiPokok = 0;
  let totalTonase = 0;
  const totalRit = rits ? rits.length : 0;

  if (rits && rits.length > 0) {
    const ritPenentuBasis = rits.slice(0, 3);
    let totalJarakBasis = 0;

    ritPenentuBasis.forEach((rit) => {
      const dbAfd = rit.afdeling.replace(/^O/, "").trim().toUpperCase();
      const dbBlok = rit.blok.trim().toUpperCase();
      totalJarakBasis += distanceMap[`${dbAfd}_${dbBlok}`] || 0;
    });

    const avgJarak = totalJarakBasis / ritPenentuBasis.length;

    let basisTon = 0;
    if (avgJarak <= 10) {
      basisTon = 25;
    } else if (avgJarak > 10 && avgJarak <= 20) {
      basisTon = 18;
    } else {
      basisTon = 13;
    }

    for (const rit of rits) {
      const dbAfd = rit.afdeling.replace(/^O/, "").trim().toUpperCase();
      const dbBlok = rit.blok.trim().toUpperCase();
      const jarakAsli = distanceMap[`${dbAfd}_${dbBlok}`] || 0;
      const ritDate = new Date(rit.completed_at);
      const isHariLibur = ritDate.getDay() === 0;

      let tarifPremiRitIni = 0;
      if (jarakAsli <= 10) {
        tarifPremiRitIni = 7000;
      } else if (jarakAsli > 10 && jarakAsli <= 20) {
        tarifPremiRitIni = isHariLibur ? 9000 : 8500;
      } else {
        tarifPremiRitIni = isHariLibur ? 11000 : 10000;
      }

      const tonase = rit.tonase_aktual || 0;
      totalTonase += tonase;

      if (isHariLibur) {
        totalPremi += tonase * tarifPremiRitIni;
      } else {
        if (basisTon > 0) {
          const hkRit = tonase / basisTon;
          const prevHK = akumulasiHK;
          akumulasiHK += hkRit;

          if (prevHK < 1 && akumulasiHK >= 1) totalGajiPokok = 157559;

          if (prevHK >= 1) {
            totalPremi += tonase * tarifPremiRitIni;
          } else if (akumulasiHK > 1) {
            totalPremi += (akumulasiHK - 1) * basisTon * tarifPremiRitIni;
          }
        }
      }
    }
  }

  return {
    tonase: totalTonase,
    totalRit,
    totalGaji: totalGajiPokok + totalPremi,
  };
};

// Menyusun arsip riwayat penugasan armada berdasarkan siklus waktu bulanan.
export const loadMonthlyRecap = async (userId) => {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const { data: blokData } = await supabase
    .from("afdeling_blok")
    .select("afdeling, blok, jarak_km");
  
  const distanceMap = {};
  if (blokData) {
    blokData.forEach(
      (b) =>
        (distanceMap[
          `${b.afdeling.trim().toUpperCase()}_${b.blok.trim().toUpperCase()}`
        ] = Number(b.jarak_km)),
    );
  }

  const { data: rits } = await supabase
    .from("orders")
    .select("id, afdeling, blok, tonase_aktual, completed_at")
    .eq("driver_id", userId)
    .eq("status", "completed")
    .gte("completed_at", startOfMonth.toISOString())
    .order("completed_at", { ascending: true }); 

  if (!rits) return [];

  const grouped = {};
  rits.forEach((r) => {
    const ritDate = new Date(r.completed_at);
    const wibDate = new Date(ritDate.getTime() + 7 * 60 * 60 * 1000);
    const dateStr = wibDate.toISOString().split("T")[0]; 
    
    if (!grouped[dateStr]) grouped[dateStr] = [];
    grouped[dateStr].push(r);
  });

  const recapList = [];

  Object.keys(grouped)
    .sort((a, b) => b.localeCompare(a))
    .forEach((dateStr) => {
      const dayRits = grouped[dateStr];
      const firstRitDate = new Date(dayRits[0].completed_at);
      const firstWibDate = new Date(firstRitDate.getTime() + 7 * 60 * 60 * 1000);
      const isLibur = firstWibDate.getUTCDay() === 0;

      const ritPenentuBasis = dayRits.slice(0, 3);
      let totalJarakBasis = 0;

      ritPenentuBasis.forEach((rit) => {
        const dbAfd = rit.afdeling.replace(/^O/, "").trim().toUpperCase();
        const dbBlok = rit.blok.trim().toUpperCase();
        totalJarakBasis += distanceMap[`${dbAfd}_${dbBlok}`] || 0;
      });

      const avgJarak = totalJarakBasis / ritPenentuBasis.length;
      let basisTonHarian = 0;

      if (avgJarak <= 10) {
        basisTonHarian = 25;
      } else if (avgJarak > 10 && avgJarak <= 20) {
        basisTonHarian = 18;
      } else {
        basisTonHarian = 13;
      }

      let akumulasiHK = 0;

      dayRits.forEach((rit) => {
        const dbAfd = rit.afdeling.replace(/^O/, "").trim().toUpperCase();
        const dbBlok = rit.blok.trim().toUpperCase();
        const jarakAsli = distanceMap[`${dbAfd}_${dbBlok}`] || 0;

        let tarifPremiRitIni = 0;
        if (jarakAsli <= 10) {
          tarifPremiRitIni = 7000;
        } else if (jarakAsli > 10 && jarakAsli <= 20) {
          tarifPremiRitIni = isLibur ? 9000 : 8500;
        } else {
          tarifPremiRitIni = isLibur ? 11000 : 10000;
        }

        const tonase = rit.tonase_aktual || 0;
        let premiumRitIni = 0;
        let gajiPokokRitIni = 0;

        if (isLibur) {
          premiumRitIni = tonase * tarifPremiRitIni;
        } else {
          if (basisTonHarian > 0) {
            const hkRit = tonase / basisTonHarian;
            const prevHK = akumulasiHK;
            akumulasiHK += hkRit;

            if (prevHK < 1 && akumulasiHK >= 1) {
              gajiPokokRitIni = 157559; 
            }

            if (prevHK >= 1) {
              premiumRitIni = tonase * tarifPremiRitIni;
            } else if (akumulasiHK > 1) {
              premiumRitIni = (akumulasiHK - 1) * basisTonHarian * tarifPremiRitIni;
            }
          }
        }

        recapList.push({
          id: rit.id,
          date: new Date(rit.completed_at),
          afdeling: rit.afdeling,
          blok: rit.blok,
          tonase: tonase,
          earned: premiumRitIni + gajiPokokRitIni,
        });
      });
    });

  recapList.sort((a, b) => b.date - a.date);
  return recapList;
};

// Melaksanakan transfer aset digital ke media penyimpanan eksternal dengan format yang dienkode.
export const uploadBuktiFoto = async (base64String, orderId) => {
  const fileName = `bukti_rit_${orderId}_${Date.now()}.jpg`;
  const { error: uploadError } = await supabase.storage
    .from("bukti_pengiriman")
    .upload(fileName, decode(base64String), { contentType: "image/jpeg" });
  if (uploadError) throw uploadError;

  const { data: urlData } = supabase.storage
    .from("bukti_pengiriman")
    .getPublicUrl(fileName);
  return urlData.publicUrl;
};

// Menjaga ketersediaan data dengan memproses otomatis pesanan yang menggantung di server.
export const prosesOrderPending = async (userId) => {
  const { data: pendingOrders } = await supabase
    .from("orders")
    .select("id")
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  if (pendingOrders && pendingOrders.length > 0) {
    for (const order of pendingOrders) {
      await supabase
        .from("orders")
        .update({ driver_id: userId, status: "assigned" })
        .eq("id", order.id)
        .eq("status", "pending");
    }
  }
};

// Meminta izin otorisasi sistem operasi dan meregistrasikan token perangkat ke basis data profil.
export const registerForPushNotifications = async (userId) => {
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "Sistem Operasional",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#2563EB",
    });
  }

  if (Device.isDevice) {
    const { status: existingStatus } =
      await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== "granted") return null;

    try {
      const token = (await Notifications.getExpoPushTokenAsync()).data;
      await supabase
        .from("profiles")
        .update({ push_token: token })
        .eq("id", userId);
      return token;
    } catch (error) {
      return null;
    }
  }
  return null;
};

// Menyimpan data operasional ke memori internal perangkat saat konektivitas jaringan terputus.
export const simpanOrderOffline = async (orderId, tonase, uriFoto) => {
  try {
    const existingData = await AsyncStorage.getItem(OFFLINE_STORAGE_KEY);
    const offlineOrders = existingData ? JSON.parse(existingData) : [];

    offlineOrders.push({
      id: orderId,
      tonase: tonase,
      uri: uriFoto,
      timestamp: new Date().toISOString(),
    });

    await AsyncStorage.setItem(
      OFFLINE_STORAGE_KEY,
      JSON.stringify(offlineOrders),
    );
    return true;
  } catch (error) {
    return false;
  }
};

// Memproses antrean data luring untuk diunggah ke basis data pusat saat jaringan kembali stabil.
export const prosesSinkronisasiOffline = async (userId) => {
  try {
    const existingData = await AsyncStorage.getItem(OFFLINE_STORAGE_KEY);
    if (!existingData) return false;

    const offlineOrders = JSON.parse(existingData);
    if (offlineOrders.length === 0) return false;

    for (const order of offlineOrders) {
      const base64Img = await FileSystem.readAsStringAsync(order.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const publicUrl = await uploadBuktiFoto(base64Img, order.id);

      await supabase
        .from("orders")
        .update({
          status: "completed",
          tonase_aktual: order.tonase,
          bukti_foto_url: publicUrl,
          completed_at: order.timestamp,
        })
        .eq("id", order.id);
    }

    await AsyncStorage.removeItem(OFFLINE_STORAGE_KEY);
    return true;
  } catch (error) {
    return false;
  }
};
