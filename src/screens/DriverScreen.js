import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../supabase";
import * as ImagePicker from "expo-image-picker";
import * as Notifications from "expo-notifications";
import NetInfo from "@react-native-community/netinfo";
import { CameraView, useCameraPermissions } from "expo-camera";

import styles from "../styles/DriverStyles";
import {
  calculateTodayStats,
  loadMonthlyRecap,
  uploadBuktiFoto,
  prosesOrderPending,
  registerForPushNotifications,
  simpanOrderOffline,
  prosesSinkronisasiOffline,
} from "../utils/driverLogic";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export default function DriverScreen() {
  const [activeTab, setActiveTab] = useState("beranda");
  const [isOnline, setIsOnline] = useState(false);
  const isOnlineRef = useRef(isOnline);
  useEffect(() => {
    isOnlineRef.current = isOnline;
  }, [isOnline]);
  const [updating, setUpdating] = useState(false);
  const [updatingOrderId, setUpdatingOrderId] = useState(null);
  const [initialLoading, setInitialLoading] = useState(true);

  const [isConnected, setIsConnected] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);

  const [activeOrders, setActiveOrders] = useState([]);
  const [poolOrders, setPoolOrders] = useState([]);
  const handleAmbilOrderPool = async (orderId) => {
    const userId = await getUserId();
    const { error } = await supabase
      .from("orders")
      .update({ driver_id: userId, status: "assigned" })
      .eq("id", orderId);
    if (error) {
      Alert.alert(
        "Gagal Ambil Order",
        "Terdapat kendala jaringan atau order sudah diambil.",
      );
    } else {
      Alert.alert(
        "Sukses",
        "Anda berhasil mengambil order ini. Cek di Beranda untuk detailnya.",
      );
      refreshData(userId);
    }
  };
  const [tonaseInputs, setTonaseInputs] = useState({});
  const [orderPhotos, setOrderPhotos] = useState({});
  const [hariIniData, setHariIniData] = useState({
    tonase: 0,
    totalRit: 0,
    totalGaji: 0,
  });
  const [rekapBulanIni, setRekapBulanIni] = useState([]);
  const [driverName, setDriverName] = useState("");
  const [acceptedOrders, setAcceptedOrders] = useState({});

  // Komponen Kamera Pemindai
  const [permission, requestPermission] = useCameraPermissions();
  const [scanningOrderId, setScanningOrderId] = useState(null);

  const manualOfflineRef = useRef(false);

  const getUserId = useCallback(async () => {
    const { data } = await supabase.auth.getUser();
    return data?.user?.id ?? null;
  }, []);

  const refreshData = useCallback(async (userId) => {
    const stats = await calculateTodayStats(userId);
    setHariIniData(stats);
    const recap = await loadMonthlyRecap(userId);
    setRekapBulanIni(recap);
  }, []);

  useEffect(() => {
    let mounted = true;
    const loadInitialData = async () => {
      const userId = await getUserId();
      if (!userId) {
        if (mounted) setInitialLoading(false);
        return;
      }

      await registerForPushNotifications(userId);

      const { data: profile } = await supabase
        .from("profiles")
        .select("is_online, nama_lengkap")
        .eq("id", userId)
        .single();

      if (mounted && profile) {
        setIsOnline(profile.is_online);
        setDriverName(profile.nama_lengkap);
      }
      if (profile?.is_online) await prosesOrderPending(userId);

      const { data: orders } = await supabase
        .from("orders")
        .select("*")
        .eq("driver_id", userId)
        .in("status", ["assigned", "in_progress"])
        .order("created_at", { ascending: true });

      if (mounted) {
        if (profile) setIsOnline(profile.is_online);
        if (orders) setActiveOrders(orders);
      }
      await refreshData(userId);
      if (mounted) setInitialLoading(false);
    };
    loadInitialData();
    return () => {
      mounted = false;
    };
  }, [getUserId, refreshData]);

  useEffect(() => {
    const unsubscribeNetInfo = NetInfo.addEventListener((state) => {
      setIsConnected(state.isConnected);
      if (state.isConnected && isOnlineRef.current) {
        jalankanSinkronisasiLatarBelakang();
      }
    });
    return () => unsubscribeNetInfo();
  }, [isOnline]);

  const jalankanSinkronisasiLatarBelakang = async () => {
    setIsSyncing(true);
    const userId = await getUserId();
    if (userId) {
      const hasilSinkronisasi = await prosesSinkronisasiOffline(userId);
      if (hasilSinkronisasi) {
        await refreshData(userId);
        Alert.alert(
          "Sinkronisasi Selesai",
          "Data pesanan luring telah berhasil dikirim ke pusat.",
        );
      }
    }
    setIsSyncing(false);
  };

  useEffect(() => {
    let orderSub;
    const listenForOrders = async () => {
      const userId = await getUserId();
      if (!userId) return;

      orderSub = supabase
        .channel(`driver-orders-${userId}-${Date.now()}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "orders",
          },
          (payload) => {
            if (
              payload.eventType === "INSERT" ||
              payload.eventType === "UPDATE"
            ) {
              const order = payload.new;

              if (order.status === "broadcast") {
                setPoolOrders((prev) => {
                  const exists = prev.find((o) => o.id === order.id);
                  return exists
                    ? prev.map((o) => (o.id === order.id ? order : o))
                    : [...prev, order];
                });
                setActiveOrders((prev) =>
                  prev.filter((o) => o.id !== order.id),
                );
                return;
              }

              setPoolOrders((prev) => prev.filter((o) => o.id !== order.id));

              if (
                payload.eventType === "UPDATE" &&
                payload.old &&
                payload.old.driver_id === userId &&
                order.driver_id === null
              ) {
                Alert.alert(
                  "Waktu Habis!",
                  "Anda terlalu lama merespons. Orderan telah disebarkan.",
                );
                setActiveOrders((prev) =>
                  prev.filter((o) => o.id !== order.id),
                );
                return;
              }

              if (order.driver_id !== userId) return;

              if (order.status === "completed") {
                refreshData(userId);
              }

              if (
                order.status === "pending" ||
                order.status === "assigned" ||
                order.status === "in_progress"
              ) {
                setActiveOrders((prev) => {
                  const exists = prev.find((o) => o.id === order.id);
                  return exists
                    ? prev.map((o) => (o.id === order.id ? order : o))
                    : [...prev, order];
                });
              } else {
                setActiveOrders((prev) =>
                  prev.filter((o) => o.id !== order.id),
                );
              }
            } else if (payload.eventType === "DELETE") {
              setActiveOrders((prev) =>
                prev.filter((o) => o.id !== payload.old.id),
              );
              setPoolOrders((prev) =>
                prev.filter((o) => o.id !== payload.old.id),
              );
            }
          },
        )
        .subscribe();
    };
    listenForOrders();
    return () => {
      if (orderSub) supabase.removeChannel(orderSub);
    };
  }, [getUserId]);

  useEffect(() => {
    let profileSub;
    const listenProfile = async () => {
      const userId = await getUserId();
      if (!userId) return;
      profileSub = supabase
        .channel(`driver-profiles-${userId}-${Date.now()}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "profiles",
            filter: `id=eq.${userId}`,
          },
          (payload) => {
            const updatedProfile = payload.new;
            if (
              updatedProfile.is_online === false &&
              isOnlineRef.current === true
            ) {
              setIsOnline(false);
              setActiveOrders([]);
              if (manualOfflineRef.current) manualOfflineRef.current = false;
              else
                Alert.alert(
                  "Penonaktifan Sistem",
                  "Karena keterlambatan respons, sistem telah mengalihkan order ke armada lain.",
                );
            } else if (updatedProfile.is_online === true) {
              setIsOnline(true);
            }
          },
        )
        .subscribe();
    };
    listenProfile();
    return () => {
      if (profileSub) supabase.removeChannel(profileSub);
    };
  }, [getUserId]);

  const toggleOnline = async () => {
    if (!isConnected)
      return Alert.alert(
        "Koneksi Terputus",
        "Sistem memerlukan internet aktif untuk merubah status operasional.",
      );
    if (updating) return;

    const newVal = !isOnline;
    if (!newVal) manualOfflineRef.current = true;

    setIsOnline(newVal);
    setUpdating(true);
    const userId = await getUserId();

    await supabase
      .from("profiles")
      .update({ is_online: newVal })
      .eq("id", userId);
    if (newVal) await prosesOrderPending(userId);

    setUpdating(false);
  };

  useEffect(() => {
    const responseSub = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const data = response.notification.request.content.data;
        if (data?.type === "cek_perjalanan")
          munculkanAlertKonfirmasi(data.orderId);
      },
    );
    const foregroundSub = Notifications.addNotificationReceivedListener(
      (notification) => {
        const data = notification.request.content.data;
        if (data?.type === "cek_perjalanan")
          munculkanAlertKonfirmasi(data.orderId);
      },
    );
    return () => {
      responseSub.remove();
      foregroundSub.remove();
    };
  }, []);

  const munculkanAlertKonfirmasi = (orderId) => {
    Alert.alert("Cek Status", "Apakah Anda sedang menuju bin?", [
      { text: "Ya", onPress: () => jadwalkanNotifikasi30Menit(orderId) },
      {
        text: "Tidak",
        onPress: () => {
          Alert.alert("Pembatalan", "Apakah Anda ingin membatalkan order?", [
            { text: "Batal", style: "cancel" },
            {
              text: "Ya, Batalkan",
              style: "destructive",
              onPress: () => handleTolakOrder(orderId),
            },
          ]);
        },
      },
    ]);
  };

  const jadwalkanNotifikasi30Menit = async (orderId) => {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: "Pengecekan Rutin",
        body: "Sistem mendeteksi Anda belum sampai. Ketuk untuk konfirmasi status perjalanan.",
        data: { orderId, type: "cek_perjalanan" },
        sound: true,
      },
      trigger: { seconds: 30 * 60 },
    });
  };

  const handleTerimaOrder = async (orderId) => {
    setAcceptedOrders((prev) => ({ ...prev, [orderId]: true }));
    jadwalkanNotifikasi30Menit(orderId);
    Alert.alert(
      "Tugas Diterima",
      "Argo perjalanan 30 menit dimulai. Segera menuju lokasi.",
    );
  };

  const handleTolakOrder = async (orderId) => {
    setUpdatingOrderId(orderId);
    try {
      await supabase
        .from("orders")
        .update({ status: "pending", driver_id: null })
        .eq("id", orderId);
      setActiveOrders((prev) => prev.filter((o) => o.id !== orderId));
      setAcceptedOrders((prev) => {
        const baru = { ...prev };
        delete baru[orderId];
        return baru;
      });
      await Notifications.cancelAllScheduledNotificationsAsync();
    } catch (err) {
      Alert.alert("Gagal", "Tidak dapat membatalkan order. Coba lagi.");
    } finally {
      setUpdatingOrderId(null);
    }
  };

  // Menjalankan verifikasi pra-syarat pemindaian sebelum perjalanan
  const inisiasiPemindaianNAB = (orderId) => {
    if (!permission) return;
    if (!permission.granted) {
      requestPermission();
      return;
    }
    setScanningOrderId(orderId);
  };

  // Memvalidasi kesamaan identitas dokumen fisik dengan pangkalan data
  const handleBarcodeValidation = async ({ data }) => {
    const scannedCode = data.trim();
    const orderToValidate = activeOrders.find((o) => o.id === scanningOrderId);

    setScanningOrderId(null); // Tutup kamera segera setelah dapat data

    if (!orderToValidate?.nab_barcode) {
      return Alert.alert(
        "Data Tidak Lengkap",
        "Order ini tidak memiliki catatan NAB dari Kerani. Silakan hubungi admin.",
      );
    }

    if (scannedCode !== orderToValidate.nab_barcode) {
      return Alert.alert(
        "Validasi Ditolak \u26A0\uFE0F",
        `Dokumen tidak cocok!\n\nNAB Tercatat: ${orderToValidate.nab_barcode}\nNAB Di-scan: ${scannedCode}\n\nPastikan Anda mengambil dokumen dan muatan yang benar.`,
      );
    }

    // Jika sukses, otomatis jalankan logika "Mulai Perjalanan"
    Alert.alert(
      "Verifikasi Berhasil",
      "Nomor NAB terkonfirmasi. Hati-hati di jalan!",
    );
    await handleMulaiPerjalanan(orderToValidate.id);
  };

  const handleMulaiPerjalanan = async (orderId) => {
    if (!isConnected)
      return Alert.alert(
        "Koneksi Terputus",
        "Sistem memerlukan internet aktif untuk merubah status perjalanan.",
      );

    setUpdatingOrderId(orderId);
    try {
      await Notifications.cancelAllScheduledNotificationsAsync();
      await supabase
        .from("orders")
        .update({ status: "in_progress", started_at: new Date().toISOString() })
        .eq("id", orderId);
      setActiveOrders((prev) =>
        prev.map((o) =>
          o.id === orderId ? { ...o, status: "in_progress" } : o,
        ),
      );
    } catch (err) {
      Alert.alert("Kesalahan Jaringan", "Gagal memperbarui status perjalanan.");
    } finally {
      setUpdatingOrderId(null);
    }
  };

  const handleAmbilFoto = async (orderId) => {
    const permissionResult = await ImagePicker.requestCameraPermissionsAsync();
    if (permissionResult.granted === false)
      return Alert.alert(
        "Akses Ditolak",
        "Izin penggunaan kamera tidak diberikan pada perangkat ini.",
      );

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.2,
      allowsMultipleSelection: false,
      maxWidth: 800,
      maxHeight: 600,
      base64: true,
    });

    if (!result.canceled) {
      setOrderPhotos((prev) => ({
        ...prev,
        [orderId]: {
          uri: result.assets[0].uri,
          base64: result.assets[0].base64,
        },
      }));
    }
  };

  const handleSelesaikanOrder = async (orderId) => {
    const order = activeOrders.find((o) => o.id === orderId);
    if (!order) return;

    const fotoData = orderPhotos[orderId];
    if (!fotoData || !fotoData.base64)
      return Alert.alert(
        "Peringatan",
        "Bukti foto penyelesaian di pabrik wajib dilampirkan.",
      );

    const kg = parseFloat((tonaseInputs[orderId] || "").replace(",", "."));
    if (isNaN(kg) || kg <= 0)
      return Alert.alert("Peringatan", "Masukkan beban tonase yang valid.");

    const tonase = kg / 1000;

    setUpdatingOrderId(orderId);

    if (!isConnected) {
      const berhasilSimpan = await simpanOrderOffline(
        orderId,
        tonase,
        fotoData.uri,
      );
      if (berhasilSimpan) {
        setActiveOrders((prev) => prev.filter((o) => o.id !== orderId));
        Alert.alert(
          "Tersimpan Sementara",
          "Jaringan terputus. Data pesanan telah diamankan di perangkat dan akan diunggah otomatis saat sinyal kembali.",
        );
      } else {
        Alert.alert(
          "Kegagalan Sistem",
          "Gagal menyimpan data ke memori internal perangkat.",
        );
      }
      setUpdatingOrderId(null);
      return;
    }

    try {
      const userId = await getUserId();
      const oldStats = await calculateTodayStats(userId);
      const publicUrl = await uploadBuktiFoto(fotoData.base64, orderId);

      await supabase
        .from("orders")
        .update({
          status: "completed",
          tonase_aktual: tonase,
          bukti_foto_url: publicUrl,
          completed_at: new Date().toISOString(),
        })
        .eq("id", orderId);

      const newStats = await calculateTodayStats(userId);
      const deltaGaji = newStats.totalGaji - oldStats.totalGaji;

      if (deltaGaji > 0) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("estimasi_gaji_bulan_ini")
          .eq("id", userId)
          .single();
        await supabase
          .from("profiles")
          .update({
            estimasi_gaji_bulan_ini:
              (Number(profile?.estimasi_gaji_bulan_ini) || 0) + deltaGaji,
          })
          .eq("id", userId);
      }

      setActiveOrders((prev) => prev.filter((o) => o.id !== orderId));
      setOrderPhotos((prev) => {
        const baru = { ...prev };
        delete baru[orderId];
        return baru;
      });
      setTonaseInputs((prev) => {
        const baru = { ...prev };
        delete baru[orderId];
        return baru;
      });
      await refreshData(userId);

      Alert.alert(
        "Tugas Selesai",
        `Data tugas berhasil dikirim ke server.\nMuatan: ${tonase} Ton\n\nTotal Hari Ini:\nBeban Keseluruhan: ${newStats.tonase.toFixed(2)} Ton\nTotal Rit Selesai: ${newStats.totalRit}`,
      );
    } catch (err) {
      Alert.alert(
        "Gagal Kirim Data",
        err.message || "Terdapat kendala jaringan atau otorisasi server.",
      );
    } finally {
      setUpdatingOrderId(null);
    }
  };

  const handleLogout = async () => {
    Alert.alert("Konfirmasi", "Yakin ingin keluar dari akun ini?", [
      { text: "Batal", style: "cancel" },
      {
        text: "Keluar",
        style: "destructive",
        onPress: async () => await supabase.auth.signOut(),
      },
    ]);
  };

  // Antarmuka Pemindai Barcode Supir
  if (scanningOrderId) {
    return (
      <View style={{ flex: 1, backgroundColor: "#000" }}>
        <CameraView
          style={{ flex: 1 }}
          facing="back"
          onBarcodeScanned={handleBarcodeValidation}
        >
          <View
            style={{
              flex: 1,
              backgroundColor: "rgba(0,0,0,0.6)",
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            <Text
              style={{
                color: "#FFF",
                fontSize: 18,
                fontWeight: "bold",
                marginBottom: 20,
              }}
            >
              Validasi Dokumen NAB
            </Text>
            <View
              style={{
                width: 280,
                height: 120,
                borderWidth: 3,
                borderColor: "#2563EB",
                borderRadius: 12,
                backgroundColor: "transparent",
              }}
            />
            <Text
              style={{
                color: "#FFF",
                marginTop: 20,
                textAlign: "center",
                paddingHorizontal: 40,
              }}
            >
              Fokuskan kamera pada barcode fisik untuk mencocokkan identitas
              muatan.
            </Text>
            <TouchableOpacity
              onPress={() => setScanningOrderId(null)}
              style={{
                marginTop: 40,
                paddingVertical: 12,
                paddingHorizontal: 30,
                backgroundColor: "#EF4444",
                borderRadius: 8,
              }}
            >
              <Text style={{ color: "#FFF", fontWeight: "bold", fontSize: 16 }}>
                Batal Pemindaian
              </Text>
            </TouchableOpacity>
          </View>
        </CameraView>
      </View>
    );
  }

  if (initialLoading)
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#2563EB" />
      </View>
    );

  const monthName = new Date().toLocaleDateString("id-ID", {
    month: "long",
    year: "numeric",
  });

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.container}
          showsVerticalScrollIndicator={false}
        >
          {activeTab === "beranda" ? (
            <>
              <View style={styles.header}>
                <Text style={styles.greetingText}>
                  Halo, {driverName || "Memuat..."}
                </Text>
                <Text style={styles.dateText}>
                  {new Date().toLocaleDateString("id-ID", {
                    weekday: "long",
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })}
                </Text>
              </View>

              {!isConnected && (
                <View
                  style={{
                    backgroundColor: "#FEE2E2",
                    padding: 10,
                    borderRadius: 8,
                    marginBottom: 15,
                  }}
                >
                  <Text
                    style={{
                      color: "#DC2626",
                      textAlign: "center",
                      fontWeight: "bold",
                    }}
                  >
                    Tidak Ada Koneksi Internet
                  </Text>
                  <Text
                    style={{
                      color: "#DC2626",
                      textAlign: "center",
                      fontSize: 12,
                    }}
                  >
                    Aplikasi beroperasi dalam mode luring.
                  </Text>
                </View>
              )}

              {isSyncing && (
                <View
                  style={{
                    backgroundColor: "#DBEAFE",
                    padding: 10,
                    borderRadius: 8,
                    marginBottom: 15,
                    flexDirection: "row",
                    justifyContent: "center",
                    alignItems: "center",
                  }}
                >
                  <ActivityIndicator
                    color="#2563EB"
                    style={{ marginRight: 8 }}
                  />
                  <Text style={{ color: "#1D4ED8", fontWeight: "bold" }}>
                    Menyinkronkan data tertunda...
                  </Text>
                </View>
              )}

              <View style={styles.statsCard}>
                <Text style={styles.statsTitle}>Performa</Text>
                <View style={styles.statsRow}>
                  <View style={styles.statItem}>
                    <Text style={styles.statValue}>
                      {hariIniData.tonase.toFixed(2)}
                    </Text>
                    <Text style={styles.statLabel}>Total Tonase</Text>
                  </View>
                  <View style={styles.statDivider} />
                  <View style={styles.statItem}>
                    <Text style={styles.statValue}>{hariIniData.totalRit}</Text>
                    <Text style={styles.statLabel}>Total Rit Selesai</Text>
                  </View>
                </View>
                <View style={styles.gajiContainer}>
                  <Text style={styles.gajiLabel}>Estimasi Pendapatan</Text>
                  <Text style={styles.gajiAmount}>
                    Rp{" "}
                    {Math.round(hariIniData.totalGaji).toLocaleString("id-ID")}
                  </Text>
                </View>
              </View>

              {activeOrders.length > 0 ? (
                <View>
                  <Text style={styles.queueHeader}>
                    Antrean Tugas ({activeOrders.length})
                  </Text>
                  {activeOrders.map((order, index) => {
                    const isThisLoading = updatingOrderId === order.id;
                    return (
                      <View key={order.id} style={styles.activeOrderCard}>
                        <View style={styles.badge}>
                          <Text style={styles.badgeText}>
                            Tugas #{index + 1}
                          </Text>
                        </View>
                        <Text style={styles.orderTitle}>
                          Afdeling: {order.afdeling}
                        </Text>
                        <Text style={styles.orderDetail}>
                          Blok: {order.blok}
                        </Text>
                        <Text style={styles.orderDetail}>
                          Estimasi Muatan: {order.estimasi_tonase} Ton
                        </Text>

                        {order.nab_barcode && (
                          <Text
                            style={[
                              styles.orderDetail,
                              {
                                color: "#2563EB",
                                fontWeight: "bold",
                                marginTop: 4,
                              },
                            ]}
                          >
                            NAB: {order.nab_barcode}
                          </Text>
                        )}

                        {order.status === "assigned" &&
                        !acceptedOrders[order.id] ? (
                          <View
                            style={{
                              flexDirection: "row",
                              marginTop: 15,
                              justifyContent: "space-between",
                            }}
                          >
                            <TouchableOpacity
                              style={[
                                styles.actionBtn,
                                {
                                  backgroundColor: "#EF4444",
                                  flex: 1,
                                  marginRight: 5,
                                },
                              ]}
                              onPress={() => handleTolakOrder(order.id)}
                            >
                              <Text style={styles.btnText}>Tolak</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[
                                styles.actionBtn,
                                {
                                  backgroundColor: "#10B981",
                                  flex: 1,
                                  marginLeft: 5,
                                },
                              ]}
                              onPress={() => handleTerimaOrder(order.id)}
                            >
                              <Text style={styles.btnText}>Ambil Order</Text>
                            </TouchableOpacity>
                          </View>
                        ) : order.status === "assigned" &&
                          acceptedOrders[order.id] ? (
                          <View>
                            <Text
                              style={{
                                fontSize: 12,
                                color: "#64748B",
                                marginBottom: 8,
                                textAlign: "center",
                                marginTop: 10,
                              }}
                            >
                              Validasi dokumen NAB fisik diperlukan sebelum
                              berangkat.
                            </Text>
                            <TouchableOpacity
                              style={[
                                styles.actionBtn,
                                { backgroundColor: "#10B981" },
                              ]}
                              onPress={() => inisiasiPemindaianNAB(order.id)}
                              disabled={updatingOrderId !== null}
                            >
                              {isThisLoading ? (
                                <ActivityIndicator color="#FFF" />
                              ) : (
                                <Text style={styles.btnText}>
                                  Scan Barcode NAB
                                </Text>
                              )}
                            </TouchableOpacity>
                          </View>
                        ) : (
                          <View style={styles.inProgressContainer}>
                            <Text style={styles.infoText}>
                              Unit di PKS. Silakan selesaikan bongkar muat.
                            </Text>
                            <Text style={styles.label}>
                              1. Foto Bukti Bongkar (Wajib)
                            </Text>
                            <TouchableOpacity
                              style={[
                                styles.photoBtn,
                                orderPhotos[order.id] && styles.photoBtnSuccess,
                              ]}
                              onPress={() => handleAmbilFoto(order.id)}
                            >
                              <Text style={styles.photoBtnText}>
                                {orderPhotos[order.id]
                                  ? "Foto Tersimpan (Ketuk untuk ganti)"
                                  : "Ambil Foto Bukti"}
                              </Text>
                            </TouchableOpacity>
                            <Text style={[styles.label, { marginTop: 10 }]}>
                              2. Input Tonase PKS (Kg)
                            </Text>
                            <TextInput
                              style={styles.input}
                              placeholder="Contoh: 5.5"
                              keyboardType="numeric"
                              value={tonaseInputs[order.id] || ""}
                              onChangeText={(val) =>
                                setTonaseInputs((prev) => ({
                                  ...prev,
                                  [order.id]: val,
                                }))
                              }
                            />
                            <TouchableOpacity
                              style={styles.finishBtn}
                              onPress={() => handleSelesaikanOrder(order.id)}
                              disabled={updatingOrderId !== null}
                            >
                              {isThisLoading ? (
                                <ActivityIndicator color="#FFF" />
                              ) : (
                                <Text style={styles.btnText}>
                                  Selesaikan Rit
                                </Text>
                              )}
                            </TouchableOpacity>
                          </View>
                        )}
                      </View>
                    );
                  })}
                </View>
              ) : (
                <View style={styles.actionContainer}>
                  <Text style={styles.actionTitle}>Status</Text>
                  <TouchableOpacity
                    activeOpacity={0.8}
                    onPress={toggleOnline}
                    style={[
                      styles.toggleButton,
                      isOnline ? styles.toggleOnline : styles.toggleOffline,
                    ]}
                  >
                    {updating ? (
                      <ActivityIndicator color="#FFF" />
                    ) : (
                      <Text style={styles.toggleText}>
                        {isOnline ? "ONLINE" : "OFFLINE"}
                      </Text>
                    )}
                  </TouchableOpacity>
                </View>
              )}

              <TouchableOpacity
                style={styles.rekapNavButton}
                onPress={() => setActiveTab("rekap")}
              >
                <Text style={styles.rekapNavText}>Lihat Rekap Bulanan</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.logoutButton}
                onPress={handleLogout}
              >
                <Text style={styles.logoutText}>Keluar</Text>
              </TouchableOpacity>
            </>
          ) : (
            <View>
              <Text style={styles.rekapHeaderTitle}>Periode: {monthName}</Text>
              {rekapBulanIni.length === 0 ? (
                <Text style={styles.rekapEmpty}>
                  Belum ada data rit selesai pada bulan ini.
                </Text>
              ) : (
                rekapBulanIni.map((item, idx) => (
                  <View key={item.id} style={styles.rekapCard}>
                    <View style={styles.rekapCardHeader}>
                      <Text style={styles.rekapDate}>
                        {item.date.toLocaleDateString("id-ID", {
                          day: "numeric",
                          month: "short",
                        })}{" "}
                        •{" "}
                        {item.date.toLocaleTimeString("id-ID", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </Text>
                      <Text style={styles.rekapRitTag}>
                        Rit #{rekapBulanIni.length - idx}
                      </Text>
                    </View>
                    <Text style={styles.rekapLokasi}>
                      Afdeling {item.afdeling} - Blok {item.blok}
                    </Text>
                    <Text style={styles.rekapTonase}>
                      Muatan {item.tonase} T
                    </Text>
                    <View style={styles.rekapDivider} />
                    <View style={styles.rekapEarnContainer}>
                      <Text style={styles.rekapEarnLabel}>Gaji / Premi</Text>
                      <Text
                        style={[
                          styles.rekapEarnValue,
                          item.earned === 0 && { color: "#94A3B8" },
                        ]}
                      >
                        {item.earned > 0
                          ? `+ Rp ${Math.round(item.earned).toLocaleString("id-ID")}`
                          : "Rp 0"}
                      </Text>
                    </View>
                  </View>
                ))
              )}
              <TouchableOpacity
                style={[styles.backButton, { marginTop: 20, marginBottom: 20 }]}
                onPress={() => setActiveTab("beranda")}
              >
                <Text style={styles.backButtonText}>Kembali ke Dashboard</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
