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

export default function LoginScreen() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!username || !password)
      return Alert.alert("Peringatan", "Harap isi Nama dan Password");

    setLoading(true);
    try {
      const formatEmail = `${username.toLowerCase().replace(/[^a-z0-9]/g, "")}@kebun.com`;
      const { error } = await supabase.auth.signInWithPassword({
        email: formatEmail,
        password,
      });

      if (error)
        Alert.alert("Gagal Masuk", "Nama Pengguna atau Kata Sandi salah.");
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
              placeholder="Contoh: THEOFILUS YOTO"
              placeholderTextColor="#94A3B8"
              value={username}
              onChangeText={setUsername}
              autoCapitalize="characters"
              autoCorrect={false}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Kata Sandi</Text>
            <TextInput
              style={styles.input}
              placeholder="Contoh: THEO-OA"
              placeholderTextColor="#94A3B8"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              autoCapitalize="characters"
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
