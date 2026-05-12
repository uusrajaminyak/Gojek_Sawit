import React from 'react';
import { SafeAreaView, StyleSheet, StatusBar } from 'react-native';

import OrderScreen from './src/screens/OrderScreen'; 

export default function App() {
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />
      
      <OrderScreen />
      
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F7FA', 
  },
});