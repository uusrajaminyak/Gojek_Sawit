import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Picker } from "@react-native-picker/picker";
import { CameraView, useCameraPermissions } from "expo-camera";
import { supabase } from "../supabase";
import NetInfo from "@react-native-community/netinfo";

import styles from "../styles/OrderStyles";
import { fetchKeraniData } from "../utils/orderLogic";
import { submitInspeksi, syncInspeksiOffline } from "../utils/inspectionLogic";

const AFDELING_OPTIONS = [
  "OA",
  "OB",
  "OC",
  "OD",
  "OE",
  "OF",
  "OG",
  "OH",
  "OI",
  "OJ",
  "OK",
  "OL",
  "OM",
  "ON",
  "BLS",
  "GWS",
  "KS",
  "TPB",
];

export default function OrderScreen() {
  const [activeTab, setActiveTab] = useState("buat");
  const [permission, requestPermission] = useCameraPermissions();
  const [isConnected, setIsConnected] = useState(true);

  const [isScanning, setIsScanning] = useState(false);
  const [hasScanned, setHasScanned] = useState(false);
  const [nabBarcode, setNabBarcode] = useState("");
  const [afdeling, setAfdeling] = useState(AFDELING_OPTIONS[0]);
  const [blokList, setBlokList] = useState([]);
  const [blok, setBlok] = useState("");
  const [estimasiTonase, setEstimasiTonase] = useState("");
  const [loadingBlok, setLoadingBlok] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [isFocused, setIsFocused] = useState(false);
  const [activeOrders, setActiveOrders] = useState([]);
  const [historyOrders, setHistoryOrders] = useState([]);

  const [inspeksiStep, setInspeksiStep] = useState(1);
  const [helper1, setHelper1] = useState("");
  const [helper2, setHelper2] = useState("");
  const [tphAwal, setTphAwal] = useState("");
  const [tphAkhir, setTphAkhir] = useState("");
  const [jumlahTphInput, setJumlahTphInput] = useState("");
  const [listTph, setListTph] = useState([]);
  const [isScanningTph, setIsScanningTph] = useState(null);
  const [isSubmittingInspeksi, setIsSubmittingInspeksi] = useState(false);
  const [keraniName, setKeraniName] = useState("");

  const getUserId = useCallback(async () => {
    const { data } = await supabase.auth.getUser();
    return data?.user?.id ?? null;
  }, []);

  const refreshData = useCallback(async (userId) => {
    const result = await fetchKeraniData(userId);
    if (result) {
      setActiveOrders(result.active);
      setHistoryOrders(result.history);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      setIsConnected(state.isConnected);
      if (state.isConnected) {
        syncInspeksiOffline();
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    let mounted = true;
    let orderSub;

    const initialize = async () => {
      const userId = await getUserId();
      if (!userId) {
        if (mounted) setInitialLoading(false);
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("nama_lengkap")
        .eq("id", userId)
        .single();
      if (mounted && profile) setKeraniName(profile.nama_lengkap);

      await refreshData(userId);
      if (mounted) setInitialLoading(false);

      orderSub = supabase
        .channel(`orders-${userId}-${Date.now()}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "orders",
            filter: `kerani_id=eq.${userId}`,
          },
          async () => {
            await refreshData(userId);
          },
        )
        .subscribe();
    };

    initialize();
    return () => {
      mounted = false;
      if (orderSub) supabase.removeChannel(orderSub);
    };
  }, [getUserId, refreshData]);

  const fetchBlok = useCallback(async (selectedAfdeling) => {
    setLoadingBlok(true);
    try {
      const dbAfdeling = selectedAfdeling.replace(/^O/, "");
      const { data, error } = await supabase
        .from("afdeling_blok")
        .select("blok")
        .eq("afdeling", dbAfdeling);
      if (error) throw error;

      const blokValues = (data || []).map((r) => r.blok).filter(Boolean);
      setBlokList(Array.from(new Set(blokValues)).sort());
      setBlok(blokValues.length > 0 ? blokValues[0] : "");
    } catch (err) {
      setBlokList([]);
      setBlok("");
    } finally {
      setLoadingBlok(false);
    }
  }, []);

  useEffect(() => {
    fetchBlok(afdeling);
  }, [afdeling, fetchBlok]);

  const handleMulaiScan = () => {
    if (!permission) return;
    if (!permission.granted) {
      requestPermission();
      return;
    }
    setIsScanning(true);
  };

  const handleMulaiScanTph = (tipe) => {
    if (!permission) return;
    if (!permission.granted) {
      requestPermission();
      return;
    }
    setIsScanningTph(tipe);
  };

  const validateBarcode = (data) => {
    const pattern = /^[A-Z]\d{6}$/i;
    return pattern.test(data.trim());
  };

  const handleGlobalBarcodeScanned = ({ data }) => {
    if (isScanning) {
      setIsScanning(false);
      if (validateBarcode(data)) {
        setHasScanned(true);
        setNabBarcode(data.trim());
        Alert.alert(
          "Validasi Berhasil",
          `Dokumen terverifikasi dengan kode: ${data.trim()}`,
        );
      } else {
        Alert.alert(
          "Validasi Ditolak",
          "Format kode tidak dikenali sebagai dokumen pengangkutan yang sah.",
        );
      }
    } else if (isScanningTph === "awal") {
      setTphAwal(data);
      setIsScanningTph(null);
      setInspeksiStep(3);
    } else if (isScanningTph === "akhir") {
      setTphAkhir(data);
      setIsScanningTph(null);
    }
  };

  const handleSubmit = async () => {
    if (!hasScanned)
      return Alert.alert(
        "Informasi",
        "Silakan scan dokumen fisik terlebih dahulu.",
      );
    if (!afdeling || !blok)
      return Alert.alert(
        "Informasi",
        "Pastikan afdeling dan blok sudah dipilih.",
      );

    const afdUpper = afdeling.toUpperCase();

    if (["BLS", "GWS", "KS", "TPB"].includes(afdUpper)) {
      return Alert.alert(
        "Akses Ditolak",
        "Area kontraktor tidak menggunakan armada internal. Gunakan menu 'Inspeksi' untuk area ini.",
      );
    }

    const kg = parseFloat(estimasiTonase.replace(",", "."));
    if (Number.isNaN(kg) || kg <= 0)
      return Alert.alert("Informasi", "Masukkan estimasi muatan yang sesuai.");

    const ton = kg / 1000;

    setSubmitting(true);
    try {
      const userId = await getUserId();

      const { data: cekDuplikat } = await supabase
        .from("orders")
        .select("id")
        .eq("nab_barcode", nabBarcode)
        .maybeSingle();

      if (cekDuplikat) {
        Alert.alert(
          "Duplikasi Ditolak",
          "NAB ini sudah pernah diinput sebelumnya.",
        );
        setSubmitting(false);
        return;
      }

      let allowedUnits = [];

      if (["OD", "OE", "OF", "OJ", "OK"].includes(afdUpper)) {
        allowedUnits = ["HF31", "HF32"];
      } else if (["OB", "OC"].includes(afdUpper)) {
        allowedUnits = ["HL14", "HL22", "HL24", "HL25"];
      } else if (["OA", "OM", "ON"].includes(afdUpper)) {
        allowedUnits = ["HL19", "HL21", "HL26", "HL17", "HL30"];
      } else if (["OG", "OH", "OI", "OL"].includes(afdUpper)) {
        allowedUnits = ["HL04", "HL06", "HL07", "HL09", "HL11", "HL20"];
      }

      let queryDrivers = supabase
        .from("profiles")
        .select("id, nama_lengkap, estimasi_gaji_bulan_ini")
        .eq("role", "driver")
        .eq("is_online", true);

      if (allowedUnits.length > 0) {
        queryDrivers = queryDrivers.in("unit_kendaraan", allowedUnits);
      }

      const { data: availableDrivers } = await queryDrivers
        .order("estimasi_gaji_bulan_ini", { ascending: true })
        .limit(1);

      const driver = availableDrivers?.length > 0 ? availableDrivers[0] : null;
      const assignedDriverId = driver ? driver.id : null;
      const driverName = driver?.nama_lengkap || "Menunggu Supir";

      const payload = {
        kerani_id: userId,
        driver_id: assignedDriverId,
        nab_barcode: nabBarcode,
        afdeling,
        blok,
        estimasi_tonase: ton,
        status: assignedDriverId ? "assigned" : "pending",
      };

      const { error } = await supabase.from("orders").insert([payload]);
      if (error) throw error;

      if (assignedDriverId) {
        Alert.alert(
          "Order Diproses",
          `Tugas telah dialokasikan kepada ${driverName}.`,
        );
      } else {
        Alert.alert(
          "Masuk Antrean",
          "Belum ada supir yang sesuai bersiaga. Order masuk ke dalam antrean tunggu.",
        );
      }

      setEstimasiTonase("");
      setHasScanned(false);
      await refreshData(userId);
    } catch (err) {
      Alert.alert("Kendala Teknis", "Gagal menyimpan pesanan ke sistem.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelOrderKerani = async (orderId, driverId) => {
    if (!isConnected) {
      return Alert.alert(
        "Koneksi Gagal",
        "Pembatalan unit rusak memerlukan jaringan internet aktif.",
      );
    }

    Alert.alert(
      "Konfirmasi Unit Rusak",
      "Apakah Anda yakin ingin membatalkan tugas ini? Unit truk supir akan otomatis dinonaktifkan dari sistem penugasan.",
      [
        { text: "Batal", style: "cancel" },
        {
          text: "Ya, Truk Rusak",
          style: "destructive",
          onPress: async () => {
            try {
              if (driverId) {
                await supabase
                  .from("profiles")
                  .update({ is_online: false })
                  .eq("id", driverId);
              }

              const { error } = await supabase
                .from("orders")
                .update({
                  status: "pending",
                  driver_id: null,
                  started_at: null,
                })
                .eq("id", orderId);

              if (error) throw error;

              Alert.alert(
                "Berhasil",
                "Tugas dibatalkan. Order dikembalikan ke antrean utama dan unit dinonaktifkan sementara",
              );
              const userId = await getUserId();
              await refreshData(userId);
            } catch (err) {
              Alert.alert(
                "Kegagalan Sistem",
                "Gagal merubah status penugasan di server.",
              );
            }
          },
        },
      ],
    );
  };

  const handleGenerateTphRows = () => {
    const num = parseInt(jumlahTphInput);
    if (isNaN(num) || num <= 0)
      return Alert.alert("Peringatan", "Masukkan jumlah TPH yang valid");
    const rows = Array.from({ length: num }, (_, i) => ({
      id: i + 1,
      brondolan: "0",
      kondisi: "OK",
    }));
    setListTph(rows);
    setInspeksiStep(4);
  };

  const updateTphRow = (id, field, value) => {
    setListTph((prev) =>
      prev.map((item) => (item.id === id ? { ...item, [field]: value } : item)),
    );
  };

  const handleFinishInspeksi = async () => {
    if (!tphAkhir)
      return Alert.alert(
        "Peringatan",
        "Scan barcode TPH akhir terlebih dahulu",
      );

    setIsSubmittingInspeksi(true);
    try {
      const userId = await getUserId();
      const { data: profile } = await supabase
        .from("profiles")
        .select("nama_lengkap")
        .eq("id", userId)
        .single();
      const namaKerani = profile?.nama_lengkap || "Nama tidak ditemukan";
      const tphBermasalah = listTph.filter(
        (t) => parseInt(t.brondolan) > 0,
      ).length;
      const totalBrondolan = listTph.reduce(
        (acc, curr) => acc + (parseInt(curr.brondolan) || 0),
        0,
      );

      const data = {
        kerani_id: userId,
        kerani_nama: namaKerani,
        afdeling,
        blok,
        helper_1: helper1,
        helper_2: helper2,
        tph_awal: tphAwal,
        tph_akhir: tphAkhir,
        jumlah_tph_inspeksi: listTph.length,
        tph_brondolan_lebih_nol: tphBermasalah,
        total_brondolan_tinggal: totalBrondolan,
      };

      const res = await submitInspeksi(data, isConnected);
      if (res.success) {
        Alert.alert(
          "Berhasil",
          res.mode === "online"
            ? "Data inspeksi berhasil dikirim ke server."
            : "Data diamankan di perangkat.",
        );
        resetInspeksi();
      } else {
        Alert.alert(
          "Gagal Mengirim Data",
          res.error || "Terjadi kesalahan saat menyimpan data inspeksi.",
        );
      }
    } catch (err) {
      Alert.alert("Kendala Teknis", "Gagal menyimpan data inspeksi ke sistem.");
    } finally {
      setIsSubmittingInspeksi(false);
    }
  };

  const resetInspeksi = () => {
    setInspeksiStep(1);
    setHelper1("");
    setHelper2("");
    setTphAwal("");
    setTphAkhir("");
    setJumlahTphInput("");
    setListTph([]);
  };

  const handleLogout = async () => {
    Alert.alert("Keluar", "Anda yakin ingin keluar dari aplikasi?", [
      { text: "Batal", style: "cancel" },
      {
        text: "Tutup",
        style: "destructive",
        onPress: async () => await supabase.auth.signOut(),
      },
    ]);
  };

  const getStatusText = (status) => {
    switch (status) {
      case "pending":
        return "Menunggu Supir";
      case "assigned":
        return "Menuju Lokasi";
      case "in_progress":
        return "Proses Bongkar Muat";
      default:
        return "Status Tidak Diketahui";
    }
  };

  if (isScanning || isScanningTph) {
    return (
      <View style={{ flex: 1 }}>
        <CameraView
          style={{ flex: 1 }}
          facing="back"
          onBarcodeScanned={handleGlobalBarcodeScanned}
        >
          <View style={styles.cameraOverlay}>
            <View style={styles.scanTarget} />
            <Text style={styles.cameraText}>Fokuskan kamera pada barcode</Text>
            <TouchableOpacity
              style={styles.cancelScanBtn}
              onPress={() => {
                setIsScanning(false);
                setIsScanningTph(null);
              }}
            >
              <Text style={styles.cancelScanText}>Batal Pemindaian</Text>
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
    <SafeAreaView
      style={styles.safeArea}
      edges={["top", "left", "right", "bottom"]}
    >
      <KeyboardAvoidingView
        style={styles.keyboardAvoid}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.tabBar}>
          {["buat", "riwayat", "inspeksi"].map((t) => (
            <TouchableOpacity
              key={t}
              onPress={() => setActiveTab(t)}
              style={[styles.tabItem, activeTab === t && styles.tabActive]}
            >
              <Text
                style={[
                  styles.tabText,
                  activeTab === t && styles.tabTextActive,
                ]}
              >
                {t === "buat"
                  ? "Order"
                  : t === "riwayat"
                    ? "Riwayat"
                    : "Inspeksi"}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {activeTab === "buat" ? (
            <>
              <View style={styles.headerContainer}>
                <Text style={styles.headerTitle}>Dashboard Kerani</Text>
                <Text style={{ fontSize: 16, color: "#64748B", marginTop: 4 }}>
                  Halo, {keraniName || "Memuat..."}
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
                    Koneksi Terputus
                  </Text>
                  <Text
                    style={{
                      color: "#DC2626",
                      textAlign: "center",
                      fontSize: 12,
                    }}
                  >
                    Pembuatan order baru dinonaktifkan.
                  </Text>
                </View>
              )}

              <View style={styles.card}>
                <View style={styles.scanSection}>
                  <Text style={styles.label}>Validasi NAB</Text>
                  {hasScanned ? (
                    <View style={styles.scanSuccessBox}>
                      <Text style={styles.scanSuccessText}>
                        Dokumen Terverifikasi
                      </Text>
                      <TouchableOpacity onPress={handleMulaiScan}>
                        <Text style={styles.scanResetText}>Ubah</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <TouchableOpacity
                      style={styles.scanButton}
                      onPress={handleMulaiScan}
                    >
                      <Text style={styles.scanButtonText}>Scan NAB</Text>
                    </TouchableOpacity>
                  )}
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Pilih Afdeling</Text>
                  <View style={styles.pickerContainer}>
                    <Picker
                      selectedValue={afdeling}
                      onValueChange={setAfdeling}
                      style={[styles.picker, { color: "#1E293B" }]}
                      dropdownIconColor="#1E293B"
                    >
                      {AFDELING_OPTIONS.map((opt) => (
                        <Picker.Item key={opt} label={`${opt}`} value={opt} />
                      ))}
                    </Picker>
                  </View>
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Pilih Blok</Text>
                  <View style={styles.pickerContainer}>
                    {loadingBlok ? (
                      <View style={styles.loadingWrapper}>
                        <ActivityIndicator color="#2563EB" />
                      </View>
                    ) : (
                      <Picker
                        selectedValue={blok}
                        onValueChange={setBlok}
                        style={[styles.picker, { color: "#1E293B" }]}
                        dropdownIconColor="#1E293B"
                        enabled={blokList.length > 0}
                      >
                        {blokList.length === 0 ? (
                          <Picker.Item label="Data Blok Kosong" value="" />
                        ) : (
                          blokList.map((b) => (
                            <Picker.Item key={b} label={`${b}`} value={b} />
                          ))
                        )}
                      </Picker>
                    )}
                  </View>
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Estimasi Muatan (Kg)</Text>
                  <TextInput
                    style={[
                      styles.textInput,
                      isFocused && styles.textInputFocused,
                    ]}
                    placeholder="Contoh: 5000"
                    placeholderTextColor="#94A3B8"
                    keyboardType="numeric"
                    value={estimasiTonase}
                    onChangeText={setEstimasiTonase}
                    onFocus={() => setIsFocused(true)}
                    onBlur={() => setIsFocused(false)}
                  />
                </View>

                <TouchableOpacity
                  style={[
                    styles.submitButton,
                    (!hasScanned || submitting || !isConnected) &&
                      styles.submitButtonDisabled,
                  ]}
                  onPress={handleSubmit}
                  disabled={!hasScanned || submitting || !isConnected}
                >
                  {submitting ? (
                    <ActivityIndicator color="#FFF" />
                  ) : (
                    <Text style={styles.submitButtonText}>
                      {hasScanned
                        ? "Kirimkan Order"
                        : "Scan NAB Terlebih Dahulu!"}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>

              <View>
                <Text style={styles.sectionTitle}>
                  Order Aktif: {activeOrders.length}
                </Text>
                {activeOrders.length === 0 ? (
                  <Text style={styles.emptyText}>Belum ada order aktif.</Text>
                ) : (
                  activeOrders.map((order) => (
                    <View key={order.id} style={styles.activeCard}>
                      <Text style={styles.activeStatus}>
                        {getStatusText(order.status)}
                      </Text>
                      <Text style={styles.driverName}>{order.driver_name}</Text>
                      <Text style={styles.orderInfo}>
                        Tujuan: Afdeling {order.afdeling} - Blok {order.blok}
                      </Text>
                      <Text style={styles.orderInfo}>
                        Estimasi Muatan: {order.estimasi_tonase} Ton
                      </Text>

                      {/* IMPLEMENTASI UTAMA FITUR 3: Tombol Pembatalan Darurat */}
                      {["assigned", "in_progress"].includes(order.status) && (
                        <TouchableOpacity
                          style={{
                            marginTop: 12,
                            backgroundColor: "#EF4444",
                            padding: 10,
                            borderRadius: 8,
                            alignItems: "center",
                          }}
                          onPress={() =>
                            handleCancelOrderKerani(order.id, order.driver_id)
                          }
                        >
                          <Text
                            style={{
                              color: "#FFF",
                              fontWeight: "bold",
                              fontSize: 13,
                            }}
                          >
                            Batalkan (Unit Rusak)
                          </Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  ))
                )}
              </View>

              <TouchableOpacity
                style={[
                  styles.logoutButton,
                  { marginTop: 30, marginBottom: 20 },
                ]}
                onPress={handleLogout}
              >
                <Text style={styles.logoutText}>Keluar</Text>
              </TouchableOpacity>
            </>
          ) : activeTab === "riwayat" ? (
            <View>
              <Text style={styles.sectionTitle}>Rekapitulasi: {monthName}</Text>
              {historyOrders.length === 0 ? (
                <Text style={styles.emptyText}>
                  Data operasional masih kosong untuk periode ini.
                </Text>
              ) : (
                historyOrders.map((item, idx) => (
                  <View key={item.id} style={styles.historyCard}>
                    <View style={styles.historyHeader}>
                      <Text style={styles.historyDate}>
                        {new Date(item.completed_at).toLocaleDateString(
                          "id-ID",
                          { day: "numeric", month: "short" },
                        )}{" "}
                        •{" "}
                        {new Date(item.completed_at).toLocaleTimeString(
                          "id-ID",
                          { hour: "2-digit", minute: "2-digit" },
                        )}
                      </Text>
                      <Text style={styles.historyStatus}>Selesai</Text>
                    </View>
                    <Text style={styles.driverName}>{item.driver_name}</Text>
                    <Text style={styles.orderInfo}>
                      Afdeling {item.afdeling} - Blok {item.blok}
                    </Text>
                    <Text style={styles.historyTonase}>
                      Total Muatan: {item.tonase_aktual} Ton
                    </Text>
                  </View>
                ))
              )}
            </View>
          ) : (
            <View style={styles.card}>
              <View style={styles.headerContainer}>
                <Text style={styles.headerTitle}>Inspeksi TPH</Text>
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
                    Koneksi Terputus
                  </Text>
                  <Text
                    style={{
                      color: "#DC2626",
                      textAlign: "center",
                      fontSize: 12,
                    }}
                  >
                    Data inspeksi akan disimpan di perangkat.
                  </Text>
                </View>
              )}

              {inspeksiStep === 1 && (
                <View>
                  <View style={styles.inputGroup}>
                    <Text style={styles.label}>Pilih Afdeling</Text>
                    <View style={styles.pickerContainer}>
                      <Picker
                        selectedValue={afdeling}
                        onValueChange={setAfdeling}
                        style={[styles.picker, { color: "#1E293B" }]}
                        dropdownIconColor="#1E293B"
                      >
                        {AFDELING_OPTIONS.map((a) => (
                          <Picker.Item key={a} label={`${a}`} value={a} />
                        ))}
                      </Picker>
                    </View>
                  </View>

                  <View style={styles.inputGroup}>
                    <Text style={styles.label}>Pilih Blok</Text>
                    <View style={styles.pickerContainer}>
                      {loadingBlok ? (
                        <View style={styles.loadingWrapper}>
                          <ActivityIndicator color="#2563EB" />
                        </View>
                      ) : (
                        <Picker
                          selectedValue={blok}
                          onValueChange={setBlok}
                          style={[styles.picker, { color: "#1E293B" }]}
                          dropdownIconColor="#1E293B"
                          enabled={blokList.length > 0}
                        >
                          {blokList.length === 0 ? (
                            <Picker.Item label="Data Blok Kosong" value="" />
                          ) : (
                            blokList.map((b) => (
                              <Picker.Item key={b} label={`${b}`} value={b} />
                            ))
                          )}
                        </Picker>
                      )}
                    </View>
                  </View>

                  <View style={styles.inputGroup}>
                    <Text style={styles.label}>Isi Nama Helper</Text>
                    <TextInput
                      style={styles.textInput}
                      placeholder="Nama Helper 1"
                      placeholderTextColor="#94A3B8"
                      value={helper1}
                      onChangeText={setHelper1}
                    />
                    <TextInput
                      style={[styles.textInput, { marginTop: 10 }]}
                      placeholder="Nama Helper 2"
                      placeholderTextColor="#94A3B8"
                      value={helper2}
                      onChangeText={setHelper2}
                    />
                  </View>

                  <View style={{ marginTop: 20 }}>
                    <TouchableOpacity
                      style={styles.scanButton}
                      onPress={() => handleMulaiScanTph("awal")}
                    >
                      <Text style={styles.scanButtonText}>Scan TPH Awal</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {inspeksiStep === 3 && (
                <View>
                  <View style={[styles.scanSuccessBox, { marginBottom: 20 }]}>
                    <Text style={styles.scanSuccessText}>
                      Titik Awal: {tphAwal}
                    </Text>
                  </View>

                  <View style={styles.inputGroup}>
                    <Text style={styles.label}>Jumlah TPH yang Diinspeksi</Text>
                    <TextInput
                      style={styles.textInput}
                      keyboardType="numeric"
                      placeholder="Contoh: 15"
                      placeholderTextColor="#94A3B8"
                      value={jumlahTphInput}
                      onChangeText={setJumlahTphInput}
                    />
                  </View>

                  <TouchableOpacity
                    style={styles.submitButton}
                    onPress={handleGenerateTphRows}
                  >
                    <Text style={styles.submitButtonText}>
                      Buat Lembar Inspeksi
                    </Text>
                  </TouchableOpacity>
                </View>
              )}

              {inspeksiStep === 4 && (
                <View>
                  {listTph.map((item) => (
                    <View
                      key={item.id}
                      style={{
                        borderWidth: 1,
                        borderColor: "#E2E8F0",
                        borderRadius: 12,
                        padding: 16,
                        marginBottom: 12,
                        backgroundColor: "#F8FAFC",
                      }}
                    >
                      <Text
                        style={{
                          fontWeight: "700",
                          color: "#334155",
                          marginBottom: 8,
                        }}
                      >
                        Inspeksi Titik Ke-{item.id}
                      </Text>
                      <View
                        style={{ flexDirection: "row", alignItems: "center" }}
                      >
                        <View style={{ flex: 1, marginRight: 12 }}>
                          <Text
                            style={{
                              fontSize: 12,
                              color: "#64748B",
                              marginBottom: 4,
                            }}
                          >
                            Sisa Brondolan
                          </Text>
                          <TextInput
                            style={[
                              styles.textInput,
                              { height: 44, backgroundColor: "#FFF" },
                            ]}
                            placeholder="Jumlah"
                            keyboardType="numeric"
                            value={item.brondolan}
                            onChangeText={(v) =>
                              updateTphRow(item.id, "brondolan", v)
                            }
                          />
                        </View>
                        <View style={{ width: 100 }}>
                          <Text
                            style={{
                              fontSize: 12,
                              color: "#64748B",
                              marginBottom: 4,
                            }}
                          >
                            Kondisi
                          </Text>
                          <TouchableOpacity
                            style={{
                              height: 44,
                              justifyContent: "center",
                              alignItems: "center",
                              backgroundColor:
                                item.kondisi === "OK" ? "#D1FAE5" : "#FEE2E2",
                              borderRadius: 8,
                              borderWidth: 1,
                              borderColor:
                                item.kondisi === "OK" ? "#10B981" : "#EF4444",
                            }}
                            onPress={() =>
                              updateTphRow(
                                item.id,
                                "kondisi",
                                item.kondisi === "OK" ? "NO OK" : "OK",
                              )
                            }
                          >
                            <Text
                              style={{
                                fontWeight: "700",
                                color:
                                  item.kondisi === "OK" ? "#065F46" : "#991B1B",
                              }}
                            >
                              {item.kondisi}
                            </Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    </View>
                  ))}

                  <TouchableOpacity
                    style={[
                      styles.scanButton,
                      {
                        marginTop: 12,
                        borderColor: "#2563EB",
                        backgroundColor: "#EFF6FF",
                      },
                    ]}
                    onPress={() => handleMulaiScanTph("akhir")}
                  >
                    <Text style={[styles.scanButtonText, { color: "#2563EB" }]}>
                      {tphAkhir ? `(${tphAkhir})` : "Scan TPH Akhir"}
                    </Text>
                  </TouchableOpacity>

                  {tphAkhir !== "" && (
                    <TouchableOpacity
                      style={[
                        styles.submitButton,
                        {
                          marginTop: 16,
                          backgroundColor: isSubmittingInspeksi
                            ? "#9CA3AF"
                            : "#10B981",
                        },
                      ]}
                      onPress={handleFinishInspeksi}
                      disabled={isSubmittingInspeksi}
                    >
                      {isSubmittingInspeksi ? (
                        <ActivityIndicator color="#FFF" />
                      ) : (
                        <Text style={styles.submitButtonText}>
                          Selesaikan Inspeksi
                        </Text>
                      )}
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
