import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../supabase";
import styles from "../styles/LoginStyles";

// Komponen utama untuk layar login autentikasi pengguna.
export default function LoginScreen() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  // Memvalidasi data input dan memulai proses autentikasi ke database.
  const handleLogin = async () => {
    if (!username || !password)
      return Alert.alert("Peringatan", "Harap isi Nama dan Password");

    setLoading(true);
    try {
      const formatEmail = `${username.trim().toLowerCase()}@kebun.com`;
      const { error } = await supabase.auth.signInWithPassword({
        email: formatEmail,
        password,
      });
      if (error)
        Alert.alert(
          "Gagal Masuk",
          "Informasi akun salah atau tidak terdaftar.",
        );
    } catch (err) {
      Alert.alert("Kesalahan Sistem", "Tidak dapat terhubung ke server.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.container}
      >
        <View style={styles.formContainer}>
          <View style={styles.header}>
            <Text style={styles.title}>AngkutPro</Text>
            <Text style={styles.subtitle}>Sistem Manajemen Hook Lift</Text>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Nama Pengguna</Text>
            <TextInput
              style={styles.input}
              placeholder="Nama Akun"
              placeholderTextColor="#94A3B8"
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Kata Sandi</Text>
            <TextInput
              style={styles.input}
              placeholder="Kata Sandi"
              placeholderTextColor="#94A3B8"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
            />
          </View>

          <TouchableOpacity
            style={styles.loginBtn}
            onPress={handleLogin}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <Text style={styles.loginBtnText}>MASUK</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
