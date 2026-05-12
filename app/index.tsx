import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator, Text } from 'react-native';
import { supabase } from '../src/supabase';
import LoginScreen from '../src/screens/LoginScreen';
import OrderScreen from '../src/screens/OrderScreen';
import DriverScreen from '../src/screens/DriverScreen';

export default function Index() {
  const [session, setSession] = useState(null);
  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) fetchUserRole(session.user.id);
      else setLoading(false);
    });

    supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) fetchUserRole(session.user.id);
      else {
        setRole(null);
        setLoading(false);
      }
    });
  }, []);

  const fetchUserRole = async (userId) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', userId)
        .single();
        
      if (!error && data) setRole(data.role);
    } catch (error) {
      console.warn("Error fetching role:", error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F1F5F9' }}>
        <ActivityIndicator size="large" color="#2563EB" />
        <Text style={{ marginTop: 12, color: '#64748B' }}>Memeriksa sesi otentikasi...</Text>
      </View>
    );
  }

  if (!session) {
    return <LoginScreen onLoginSuccess={(user) => fetchUserRole(user.id)} />;
  }

  if (role === 'kerani') {
    return <OrderScreen />;
  } else if (role === 'driver') {
    return <DriverScreen />;
  } else {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <Text>Role tidak ditemukan. Hubungi Admin.</Text>
      </View>
    );
  }
}