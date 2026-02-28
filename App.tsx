import { GestureHandlerRootView } from 'react-native-gesture-handler';
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  StyleSheet, Text, View, TextInput, TouchableOpacity, Image,
  ScrollView, Alert, ActivityIndicator, Modal, Platform,
  KeyboardAvoidingView, FlatList, Keyboard, Animated, Dimensions,
  Linking, PermissionsAndroid,
} from 'react-native';
import Geolocation from '@react-native-community/geolocation';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { initializeApp, getApps } from '@react-native-firebase/app';
import auth, { FirebaseAuthTypes } from '@react-native-firebase/auth';
import database from '@react-native-firebase/database';
import { launchImageLibrary, launchCamera } from 'react-native-image-picker';
import Ionicons from 'react-native-vector-icons/Ionicons';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

// Initialize Firebase
if (Platform.OS === 'web') {
  if (!getApps().length) {
    initializeApp({
      apiKey: 'AIzaSyAof8LPnKFTlnRQgRaD-EUDMlnSmPz9_44',
      authDomain: 'fir-dddb2.firebaseapp.com',
      databaseURL: 'https://fir-dddb2-default-rtdb.firebaseio.com',
      projectId: 'fir-dddb2',
      storageBucket: 'fir-dddb2.firebasestorage.app',
      messagingSenderId: '374284591449',
      appId: '1:374284591449:web:dd28359035026950946c48',
      measurementId: 'G-2C2BMLHGWJ',
    });
  }
}
// For Android/iOS, Firebase auto-initializes from google-services.json in the native layer

// ── Constants ────────────────────────────────────────────────────────
const DEFAULT_AVATAR = 'https://i.pravatar.cc/150?img=7';
const DEFAULT_SHOP_LOGO = 'https://i.pravatar.cc/150?img=50';
const BLUE = '#1a73e8';
const DARK_BLUE = '#0d47a1';
const ACCENT = '#ff6f00';
const BG = '#f0f4f9';
const CARD = '#ffffff';
const TEXT_DARK = '#0d2137';
const TEXT_MID = '#4a6580';
const TEXT_LIGHT = '#8faabb';
const BORDER = '#dde8f2';
const SUCCESS = '#00897b';
const WHATSAPP_GREEN = '#25D366';
const CALL_BLUE = '#1a73e8';
const DEEP_BLUE = '#0d2fa3';

const IMAGE_PICKER_OPTIONS: Parameters<typeof launchImageLibrary>[0] = {
  mediaType: 'photo', includeBase64: true, maxWidth: 1200, maxHeight: 1200,
};

const SHOP_CATEGORIES = [
  'Kirana / General Store','Supermarket / Mini-Mart','Vegetable & Fruit Vendor',
  'Dairy Booth / Milk Parlor','Pharmacy / Medical Store','Apparel / Ready-made Garments',
  'Saree & Textile Shop','Footwear Shop','Jewelry Store','Watch & Opticals',
  'Bag & Accessories Shop','Mobile & Accessories Store','Consumer Electronics Showroom',
  'Computer / Laptop Shop','Electrical Hardware Shop','Hardware & Paint Store',
  'Furniture Showroom','Kitchenware / Utensils Shop','Sanitaryware & Tiles',
  'Plywood & Glass Shop','Sweet Mart / Condiments','Bakery & Cake Shop',
  'Meat / Chicken Shop','Tea / Coffee Stall','Ice Cream Parlor',
  'Stationery & Xerox / Print Shop','Salon / Barber Shop',
  'Automobile Spares (Two/Four Wheeler)','Gift & Novelty Shop','Flower Shop / Florist',
  'Cycle Shop','Others',
];

// ── Types ────────────────────────────────────────────────────────────
type UserRole = 'user' | 'shopkeeper' | null;
interface UserData {
  email?: string; role?: UserRole; fullName?: string; shopName?: string;
  photoURL?: string; shopPhoto?: string; note?: string; about?: string;
  type?: string; age?: string; gender?: string; phone?: string;
  dob?: string; location?: string; createdAt?: number;
  // Location coordinates for proximity sorting
  latitude?: number; longitude?: number;
}
interface Product {
  shopId: string; name: string; quantity: string; price: string;
  photo?: string; note?: string; category?: string; timestamp: number;
}
interface Review {
  rating: number; comment: string; timestamp: number; userName: string;
}
interface QueryItem {
  userId: string; userName: string; question: string; answer: string;
  timestamp: number; answerTimestamp: number | null; answeredBy: string | null;
}

// ── Global Data Store ────────────────────────────────────────────────
const GlobalStore = {
  shops: {} as { [key: string]: UserData },
  products: {} as { [shopId: string]: { [pId: string]: Product } },
  allProducts: {} as { [pId: string]: Product },
  cartCount: 0,
  userLocation: null as { latitude: number; longitude: number } | null,
  listeners: {} as { [key: string]: () => void },
};

// ── Location Helpers ──────────────────────────────────────────────────
const requestLocationPermission = async (): Promise<boolean> => {
  if (Platform.OS === 'android') {
    try {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        {
          title: 'Location Permission',
          message: 'CityLinks needs your location to show nearby shops.',
          buttonNeutral: 'Ask Me Later',
          buttonNegative: 'Cancel',
          buttonPositive: 'Allow',
        }
      );
      return granted === PermissionsAndroid.RESULTS.GRANTED;
    } catch {
      return false;
    }
  }
  return true; // iOS handles via Info.plist
};

const getCurrentLocation = (): Promise<{ latitude: number; longitude: number; cityName?: string }> =>
  new Promise((resolve, reject) => {
    Geolocation.getCurrentPosition(
      async pos => {
        const { latitude, longitude } = pos.coords;
        // Reverse geocode using free nominatim API
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`,
            { headers: { 'User-Agent': 'CityLinksApp/1.0' } }
          );
          const data = await res.json();
          const cityName =
            data?.address?.city ||
            data?.address?.town ||
            data?.address?.village ||
            data?.address?.county ||
            data?.address?.state_district ||
            '';
          resolve({ latitude, longitude, cityName });
        } catch {
          resolve({ latitude, longitude });
        }
      },
      err => reject(err),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    );
  });

// Haversine distance in km between two lat/lng points
const haversineKm = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const formatDistance = (km: number): string => {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
};

// ── Context ──────────────────────────────────────────────────────────
const AppContext = React.createContext<{
  currentUser: FirebaseAuthTypes.User | null;
  currentRole: UserRole;
  setCurrentUser: (u: FirebaseAuthTypes.User | null) => void;
  setCurrentRole: (r: UserRole) => void;
  tempProdPhoto: string | null; setTempProdPhoto: (v: string | null) => void;
}>({
  currentUser: null, currentRole: null,
  setCurrentUser: () => {}, setCurrentRole: () => {},
  tempProdPhoto: null, setTempProdPhoto: () => {},
});

const Stack = createStackNavigator();

// ── Helper: pick photo ───────────────────────────────────────────────
const pickPhoto = (callback: (b64: string) => void) => {
  Alert.alert('Photo', 'Choose source', [
    { text: 'Camera', onPress: () => launchCamera(IMAGE_PICKER_OPTIONS, res => {
        if (!res.didCancel && res.assets?.[0]?.base64) {
          const b64 = res.assets[0].base64!;
          callback(b64.startsWith('data:') ? b64 : `data:image/jpeg;base64,${b64}`);
        }
      }),
    },
    { text: 'Gallery', onPress: () => launchImageLibrary(IMAGE_PICKER_OPTIONS, res => {
        if (!res.didCancel && res.assets?.[0]?.base64) {
          const b64 = res.assets[0].base64!;
          callback(b64.startsWith('data:') ? b64 : `data:image/jpeg;base64,${b64}`);
        }
      }),
    },
    { text: 'Cancel', style: 'cancel' },
  ]);
};

// ── Contact Action Helpers ───────────────────────────────────────────
const handleCall = (phone: string) => {
  const cleaned = phone.replace(/\s+/g, '').replace(/-/g, '');
  const url = `tel:${cleaned}`;
  Linking.canOpenURL(url).then(supported => {
    if (supported) Linking.openURL(url);
    else Alert.alert('Error', 'Unable to make a call on this device.');
  }).catch(() => Alert.alert('Error', 'Could not open dialer.'));
};

const handleWhatsApp = (phone: string) => {
  const cleaned = phone.replace(/\D/g, '');
  const url = `whatsapp://send?phone=${cleaned}`;
  Linking.canOpenURL(url).then(supported => {
    if (supported) Linking.openURL(url);
    else {
      // fallback to web WhatsApp
      Linking.openURL(`https://wa.me/${cleaned}`);
    }
  }).catch(() => Alert.alert('WhatsApp not installed', 'Please install WhatsApp to use this feature.'));
};

// ── Animated Contact Button ──────────────────────────────────────────
const ContactBtn = ({ icon, label, color, onPress }: { icon: string; label: string; color: string; onPress: () => void }) => {
  const scale = useRef(new Animated.Value(1)).current;
  const pressIn = () => Animated.spring(scale, { toValue: 0.92, useNativeDriver: true, speed: 30 }).start();
  const pressOut = () => Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 10 }).start();

  return (
    <Animated.View style={{ transform: [{ scale }], flex: 1 }}>
      <TouchableOpacity
        style={[styles.contactBtn, { backgroundColor: color }]}
        onPress={onPress}
        onPressIn={pressIn}
        onPressOut={pressOut}
        activeOpacity={1}
      >
        <View style={styles.contactBtnInner}>
          <Ionicons name={icon as any} size={16} color="white" />
          <Text style={styles.contactBtnText}>{label}</Text>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
};

// ── Animated Shop Card ───────────────────────────────────────────────
const AnimatedShopCard = ({ _shopId, shop, onPress, index, distanceKm }: {
  _shopId?: string; shop: UserData; onPress: () => void; index: number; distanceKm?: number;
}) => {
  const translateY = useRef(new Animated.Value(40)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(translateY, { toValue: 0, duration: 400, delay: Math.min(index * 60, 360), useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 400, delay: Math.min(index * 60, 360), useNativeDriver: true }),
    ]).start();
  }, [index, opacity, translateY]);

  const pressIn = () => Animated.spring(scale, { toValue: 0.97, useNativeDriver: true, speed: 30 }).start();
  const pressOut = () => Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 8 }).start();

  const hasPhone = !!shop.phone;

  return (
    <Animated.View style={{ transform: [{ translateY }, { scale }], opacity }}>
      <View style={styles.shopCardEnhanced}>
        <TouchableOpacity
          style={styles.shopCardTop}
          onPress={onPress}
          onPressIn={pressIn}
          onPressOut={pressOut}
          activeOpacity={1}
        >
          <View style={styles.shopImgWrap}>
            <Image source={{ uri: shop.shopPhoto || DEFAULT_SHOP_LOGO }} style={styles.shopCardImg} />
            <View style={styles.shopOnlineDot} />
          </View>
          <View style={styles.shopCardBody}>
            <Text style={styles.shopCardName} numberOfLines={1}>{shop.shopName}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <View style={styles.typePill}>
                <Text style={styles.typePillText}>{shop.type || 'General'}</Text>
              </View>
              {distanceKm !== undefined && (
                <View style={styles.distancePill}>
                  <Ionicons name="navigate" size={10} color={SUCCESS} />
                  <Text style={styles.distancePillText}>{formatDistance(distanceKm)}</Text>
                </View>
              )}
            </View>
            {shop.note ? <Text style={styles.shopCardNote} numberOfLines={1}>🎉 {shop.note}</Text> : null}
            {shop.location ? (
              <View style={styles.locationRow}>
                <Ionicons name="location-outline" size={11} color={TEXT_LIGHT} />
                <Text style={styles.shopLocationText} numberOfLines={1}>{shop.location}</Text>
              </View>
            ) : null}
          </View>
          <View style={styles.shopCardArrow}>
            <Ionicons name="chevron-forward" size={18} color={BLUE} />
          </View>
        </TouchableOpacity>

        {hasPhone && (
          <View style={styles.contactRow}>
            <View style={styles.contactDivider} />
            <View style={styles.contactBtnsWrap}>
              <ContactBtn icon="call" label="Call" color={CALL_BLUE} onPress={() => handleCall(shop.phone!)} />
              <View style={{ width: 8 }} />
              <ContactBtn icon="logo-whatsapp" label="WhatsApp" color={WHATSAPP_GREEN} onPress={() => handleWhatsApp(shop.phone!)} />
            </View>
          </View>
        )}
      </View>
    </Animated.View>
  );
};

// ── Floating Bubbles Animation ──────────────────────────────────────
interface BubbleConfig {
  id: number; x: number; size: number; duration: number; delay: number; opacity: number;
}

const generateBubbles = (count: number): BubbleConfig[] =>
  Array.from({ length: count }, (_, i) => ({
    id: i,
    x: Math.random() * SCREEN_W,
    size: 8 + Math.random() * 44,
    duration: 4000 + Math.random() * 6000,
    delay: Math.random() * 4000,
    opacity: 0.08 + Math.random() * 0.22,
  }));

const SingleBubble = ({ config }: { config: BubbleConfig }) => {
  const translateY = useRef(new Animated.Value(SCREEN_H + 60)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const animate = () => {
      translateY.setValue(SCREEN_H + 60);
      opacity.setValue(0);
      scale.setValue(0.3 + Math.random() * 0.4);
      Animated.sequence([
        Animated.delay(config.delay),
        Animated.parallel([
          Animated.timing(translateY, {
            toValue: -80,
            duration: config.duration,
            useNativeDriver: true,
          }),
          Animated.sequence([
            Animated.timing(opacity, { toValue: config.opacity, duration: 800, useNativeDriver: true }),
            Animated.delay(config.duration - 1600),
            Animated.timing(opacity, { toValue: 0, duration: 800, useNativeDriver: true }),
          ]),
          Animated.timing(scale, { toValue: 1, duration: config.duration * 0.4, useNativeDriver: true }),
        ]),
      ]).start(() => animate());
    };
    animate();
  }, [config.delay, config.duration, config.opacity, opacity, scale, translateY]);

  return (
    <Animated.View
      style={{
        position: 'absolute',
        left: config.x - config.size / 2,
        width: config.size,
        height: config.size,
        borderRadius: config.size / 2,
        borderWidth: 1.5,
        borderColor: 'rgba(255,255,255,0.5)',
        backgroundColor: 'rgba(255,255,255,0.06)',
        transform: [{ translateY }, { scale }],
        opacity,
      }}
    />
  );
};

const FloatingBubbles = ({ count = 14 }: { count?: number }) => {
  const bubbles = useRef(generateBubbles(count)).current;
  return (
    <View style={{ ...StyleSheet.absoluteFillObject, overflow: 'hidden' }} pointerEvents="none">
      {bubbles.map(b => <SingleBubble key={b.id} config={b} />)}
    </View>
  );
};

// ── Lightweight Ambient Orbs (performance-safe, single loop per orb) ──
const AmbientOrb = React.memo(({ x, y, size, color, duration, delay }: {
  x: number; y: number; size: number; color: string; duration: number; delay: number;
}) => {
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.parallel([
          Animated.timing(scale, { toValue: 1.18, duration, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0.9, duration, useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(scale, { toValue: 1, duration, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0.5, duration, useNativeDriver: true }),
        ]),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [delay, duration, opacity, scale]);

  return (
    <Animated.View
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        transform: [{ scale }],
        opacity,
      }}
      pointerEvents="none"
    />
  );
});

// Static pre-computed orb configs — no re-randomization on render
const DASHBOARD_ORBS = [
  { x: -60, y: -40, size: 220, color: 'rgba(26,115,232,0.12)', duration: 4000, delay: 0 },
  { x: SCREEN_W - 100, y: 40, size: 180, color: 'rgba(13,47,163,0.10)', duration: 5000, delay: 800 },
  { x: 30, y: 140, size: 140, color: 'rgba(26,115,232,0.08)', duration: 3500, delay: 1500 },
  { x: SCREEN_W - 80, y: 250, size: 160, color: 'rgba(21,101,192,0.09)', duration: 4500, delay: 400 },
];

const DashboardBackground = React.memo(() => (
  <View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: '#f0f4f9' }} pointerEvents="none">
    {DASHBOARD_ORBS.map((o, i) => <AmbientOrb key={i} {...o} />)}
  </View>
));

// ── Error Banner ─────────────────────────────────────────────────────
const ErrorBanner = ({ title, message, onDismiss, style }: any) => (
  <View style={[styles.errorBanner, style]}>
    <View style={styles.errorIcon}><Ionicons name="warning" size={20} color="#fff" /></View>
    <View style={{ flex: 1 }}>
      <Text style={styles.errorTitle}>{title}</Text>
      <Text style={styles.errorMsg}>{message}</Text>
    </View>
    <TouchableOpacity onPress={onDismiss} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
      <Ionicons name="close-circle" size={24} color="#c0392b" />
    </TouchableOpacity>
  </View>
);

// ── Skeleton Loader ──────────────────────────────────────────────────
const SkeletonBox = ({ w, h, r = 8, style }: { w: number | string; h: number; r?: number; style?: any }) => {
  const anim = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    Animated.loop(Animated.sequence([
      Animated.timing(anim, { toValue: 1, duration: 800, useNativeDriver: true }),
      Animated.timing(anim, { toValue: 0.4, duration: 800, useNativeDriver: true }),
    ])).start();
  }, [anim]);
  return <Animated.View style={[{ width: w as any, height: h, borderRadius: r, backgroundColor: '#dde8f2', opacity: anim }, style]} />;
};

const ShopCardSkeleton = () => (
  <View style={[styles.shopCardEnhanced, { padding: 14 }]}>
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <SkeletonBox w={72} h={72} r={16} />
      <View style={{ flex: 1, marginLeft: 14, gap: 8 }}>
        <SkeletonBox w="70%" h={18} r={6} />
        <SkeletonBox w="40%" h={14} r={6} />
        <SkeletonBox w="55%" h={12} r={6} />
      </View>
    </View>
    <View style={{ height: 1, backgroundColor: BORDER, marginTop: 12, marginBottom: 10 }} />
    <View style={{ flexDirection: 'row', gap: 8 }}>
      <SkeletonBox w="48%" h={36} r={10} />
      <SkeletonBox w="48%" h={36} r={10} />
    </View>
  </View>
);

// ── Location Picker Component ────────────────────────────────────────
const LocationPicker = ({
  value, onChange, onCoordsChange, label = 'Location / Area',
}: {
  value: string;
  onChange: (v: string) => void;
  onCoordsChange?: (lat: number, lng: number) => void;
  label?: string;
}) => {
  const [detecting, setDetecting] = useState(false);

  const handleAutoDetect = async () => {
    setDetecting(true);
    try {
      const granted = await requestLocationPermission();
      if (!granted) {
        Alert.alert('Permission denied', 'Please allow location access in settings to use this feature.');
        setDetecting(false);
        return;
      }
      const { latitude, longitude, cityName } = await getCurrentLocation();
      if (cityName) onChange(cityName);
      if (onCoordsChange) onCoordsChange(latitude, longitude);
      GlobalStore.userLocation = { latitude, longitude };
    } catch (_e: any) {
      Alert.alert('Location Error', 'Could not detect location. Please enter manually.');
    } finally {
      setDetecting(false);
    }
  };

  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.locationPickerWrap}>
        <TextInput
          style={styles.locationInput}
          value={value}
          onChangeText={onChange}
          placeholder="City / Area (e.g. Mysore)"
          placeholderTextColor={TEXT_LIGHT}
          returnKeyType="done"
        />
        <TouchableOpacity
          style={[styles.locationDetectBtn, detecting && { opacity: 0.6 }]}
          onPress={handleAutoDetect}
          disabled={detecting}
        >
          {detecting
            ? <ActivityIndicator size="small" color="white" />
            : <>
                <Ionicons name="locate" size={15} color="white" />
                <Text style={styles.locationDetectText}>Auto</Text>
              </>}
        </TouchableOpacity>
      </View>
      <Text style={styles.phoneHint}>
        <Ionicons name="information-circle-outline" size={12} color={TEXT_LIGHT} />
        {' '}Tap "Auto" to detect your location, or type it manually
      </Text>
    </View>
  );
};

// ── Password Input ───────────────────────────────────────────────────
const PasswordInput = ({ value, onChange, placeholder, show, setShow, returnKeyType, onSubmit }: any) => (
  <View style={styles.pwWrap}>
    <TextInput style={styles.pwInput} placeholder={placeholder} placeholderTextColor={TEXT_LIGHT}
      secureTextEntry={!show} value={value} onChangeText={onChange}
      returnKeyType={returnKeyType || 'next'} blurOnSubmit={returnKeyType === 'done'} onSubmitEditing={onSubmit} />
    <TouchableOpacity style={styles.pwEye} onPress={() => setShow(!show)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
      <Ionicons name={show ? 'eye-off-outline' : 'eye-outline'} size={22} color={BLUE} />
    </TouchableOpacity>
  </View>
);

// ── Splash ───────────────────────────────────────────────────────────
const SplashScreen = ({ onFinish }: { onFinish: () => void }) => {
  const logoScale = useRef(new Animated.Value(0.5)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const textY = useRef(new Animated.Value(30)).current;
  const waveScale = useRef(new Animated.Value(0.8)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.spring(logoScale, { toValue: 1, useNativeDriver: true, tension: 40, friction: 7, delay: 200 }),
      Animated.timing(textY, { toValue: 0, duration: 700, delay: 300, useNativeDriver: true }),
      Animated.spring(waveScale, { toValue: 1, useNativeDriver: true, tension: 30, friction: 8, delay: 100 }),
    ]).start();
    const t = setTimeout(onFinish, 2400);
    return () => clearTimeout(t);
  }, [logoScale, onFinish, opacity, textY, waveScale]);

  return (
    <View style={{ flex: 1, backgroundColor: DEEP_BLUE }}>
      <View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: '#0a2472' }} />
      {/* Decorative blobs */}
      <View style={{ position: 'absolute', top: -120, right: -80, width: 380, height: 380, borderRadius: 190, backgroundColor: 'rgba(30,100,255,0.25)' }} />
      <View style={{ position: 'absolute', top: 100, left: -70, width: 250, height: 250, borderRadius: 125, backgroundColor: 'rgba(10,50,200,0.2)' }} />
      <View style={{ position: 'absolute', bottom: 80, right: -50, width: 300, height: 300, borderRadius: 150, backgroundColor: 'rgba(15,70,220,0.18)' }} />
      <FloatingBubbles count={20} />
      {/* Wave layer at bottom */}
      <Animated.View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 200, transform: [{ scaleX: waveScale }] }}>
        <View style={{ position: 'absolute', bottom: -40, left: -30, right: -30, height: 200, borderTopLeftRadius: 130, borderTopRightRadius: 90, backgroundColor: 'rgba(255,255,255,0.08)' }} />
        <View style={{ position: 'absolute', bottom: -60, left: -10, right: -20, height: 160, borderTopLeftRadius: 70, borderTopRightRadius: 150, backgroundColor: 'rgba(255,255,255,0.05)' }} />
      </Animated.View>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
  <Animated.View
    style={[
      styles.splashLogo,
      { transform: [{ scale: logoScale }], opacity }
    ]}
  >
    <Image
      source={require('./Ofice_logo/logo.png')}  // 👈 adjust path if needed
      style={{ width: 90, height: 90 }}
      resizeMode="contain"
    />
  </Animated.View>

  <Animated.View
    style={{
      transform: [{ translateY: textY }],
      opacity,
      alignItems: 'center'
    }}
  >
    <Text style={styles.splashTitle}>CityLinks</Text>
    <Text style={styles.splashSub}>shop local • real-time</Text>
  </Animated.View>
</View>

    </View>
  );
};

// ── Auth Screen ──────────────────────────────────────────────────────
const AuthScreen = ({ navigation: _navigation }: any) => {
  const [tab, setTab] = useState<'login' | 'signup'>('login');
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPass, setSignupPass] = useState('');
  const [signupConfirm, setSignupConfirm] = useState('');
  const [role, setRole] = useState<UserRole>(null);
  const [error, setError] = useState<{ title: string; message: string } | null>(null);
  const [showLP, setShowLP] = useState(false);
  const [showSP, setShowSP] = useState(false);
  const [showSC, setShowSC] = useState(false);
  const [loading, setLoading] = useState(false);
  const { setCurrentUser, setCurrentRole } = React.useContext(AppContext);

  const getErr = (e: any, ctx: string) => {
    const msg = String(e?.message || e || 'Something went wrong');
    if (/network|request failed|fetch|connection|internet|timeout/i.test(msg))
      return { title: 'Connection problem', message: 'Check your internet and try again.' };
    if (ctx === 'login') {
      if (/invalid.*email|user.*not.*found/i.test(msg)) return { title: 'Login failed', message: 'No account with this email.' };
      if (/wrong.*password|invalid.*password/i.test(msg)) return { title: 'Wrong password', message: 'Incorrect password. Try again.' };
    }
    if (ctx === 'signup' && /email.*already|already.*use/i.test(msg))
      return { title: 'Email in use', message: 'An account already exists with this email.' };
    return { title: 'Error', message: msg };
  };

  const handleLogin = async () => {
    if (!loginEmail || !loginPass) { setError({ title: 'Missing fields', message: 'Enter email and password.' }); return; }
    setError(null); setLoading(true);
    try {
      const c = await auth().signInWithEmailAndPassword(loginEmail, loginPass);
      setCurrentUser(c.user);
    } catch (e) { setError(getErr(e, 'login')); }
    finally { setLoading(false); }
  };

  const handleSignup = async () => {
    setError(null);
    if (!role) { setError({ title: 'Select role', message: 'Choose Customer or Shopkeeper.' }); return; }
    if (signupPass !== signupConfirm) { setError({ title: "Passwords don't match", message: 'Both fields must match.' }); return; }
    if (signupPass.length < 6) { setError({ title: 'Weak password', message: 'Minimum 6 characters.' }); return; }
    setLoading(true);
    try {
      const c = await auth().createUserWithEmailAndPassword(signupEmail, signupPass);
      await database().ref(`users/${c.user.uid}`).set({
        email: signupEmail, role, createdAt: Date.now(),
        photoURL: role === 'user' ? DEFAULT_AVATAR : DEFAULT_SHOP_LOGO,
      });
      setCurrentUser(c.user); setCurrentRole(role);
    } catch (e) { setError(getErr(e, 'signup')); }
    finally { setLoading(false); }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: DEEP_BLUE }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={20}>
      {/* Blue bubble background */}
      <View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: '#0a2472' }} />
      <View style={{ position: 'absolute', top: -100, right: -60, width: 300, height: 300, borderRadius: 150, backgroundColor: 'rgba(30,100,255,0.22)' }} />
      <View style={{ position: 'absolute', top: 60, left: -50, width: 200, height: 200, borderRadius: 100, backgroundColor: 'rgba(10,60,200,0.18)' }} />
      <FloatingBubbles count={14} />

      <ScrollView contentContainerStyle={styles.authContainer} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {/* Top blue header zone */}
        <View style={styles.authHeader}>
          <View style={styles.authLogoBubble}><Ionicons name="storefront" size={48} color="white" /></View>
          <Text style={styles.authTitle}>CityLinks</Text>
          <Text style={styles.authSubtitle}>Discover local shops, delivered fast</Text>
        </View>

        {/* White wave card at bottom */}
        <View style={styles.authWaveCard}>
          {/* Wave cutout at top of card */}
          <View style={styles.authWaveTop} />
          <View style={{ paddingHorizontal: 22, paddingTop: 8, paddingBottom: 28 }}>
            {error && <ErrorBanner title={error.title} message={error.message} onDismiss={() => setError(null)} style={{ marginBottom: 16 }} />}

            <View style={styles.tabRow}>
              {(['login', 'signup'] as const).map(t => (
                <TouchableOpacity key={t} style={[styles.tabBtn, tab === t && styles.tabBtnActive]}
                  onPress={() => { setTab(t); setError(null); }}>
                  <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
                    {t === 'login' ? 'Sign In' : 'Register'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {tab === 'login' ? (<>
              <TextInput style={styles.input} placeholder="Email address" placeholderTextColor={TEXT_LIGHT}
                value={loginEmail} onChangeText={setLoginEmail} keyboardType="email-address" autoCapitalize="none" returnKeyType="next" />
              <PasswordInput value={loginPass} onChange={setLoginPass} placeholder="Password"
                show={showLP} setShow={setShowLP} returnKeyType="done" onSubmit={handleLogin} />
              <TouchableOpacity style={styles.forgotLink}>
                <Text style={styles.forgotText}>Forgot password?</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btn, loading && { opacity: 0.7 }]} onPress={handleLogin} disabled={loading}>
                {loading ? <ActivityIndicator size="small" color="white" /> : <Ionicons name="log-in-outline" size={20} color="white" />}
                <Text style={styles.btnText}> {loading ? 'Signing in…' : 'Sign In'}</Text>
              </TouchableOpacity>
            </>) : (<>
              <TextInput style={styles.input} placeholder="Email address" placeholderTextColor={TEXT_LIGHT}
                value={signupEmail} onChangeText={setSignupEmail} keyboardType="email-address" autoCapitalize="none" returnKeyType="next" />
              <PasswordInput value={signupPass} onChange={setSignupPass} placeholder="Password" show={showSP} setShow={setShowSP} returnKeyType="next" />
              <PasswordInput value={signupConfirm} onChange={setSignupConfirm} placeholder="Confirm password" show={showSC} setShow={setShowSC} returnKeyType="done" onSubmit={handleSignup} />
              <Text style={styles.roleLabel}>Join as</Text>
              <View style={styles.roleRow}>
                {([['shopkeeper', 'storefront-outline', 'Shopkeeper'], ['user', 'person-outline', 'Customer']] as const).map(([r, icon, label]) => (
                  <TouchableOpacity key={r} style={[styles.roleBtn, role === r && styles.roleBtnActive]} onPress={() => setRole(r)}>
                    <Ionicons name={icon as any} size={18} color={role === r ? 'white' : BLUE} />
                    <Text style={[styles.roleBtnText, role === r && { color: 'white' }]}>{label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TouchableOpacity style={[styles.btn, loading && { opacity: 0.7 }]} onPress={handleSignup} disabled={loading}>
                {loading ? <ActivityIndicator size="small" color="white" /> : <Ionicons name="person-add-outline" size={20} color="white" />}
                <Text style={styles.btnText}> {loading ? 'Creating…' : 'Create Account'}</Text>
              </TouchableOpacity>
            </>)}
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

// ── Shopkeeper Details Form ── ENHANCED WITH PHONE + LOCATION ───────
const ShopkeeperDetailsForm = ({ navigation }: any) => {
  const { currentUser, setCurrentRole } = React.useContext(AppContext);
  const [shopName, setShopName] = useState('');
  const [shopNote, setShopNote] = useState('');
  const [shopAbout, setShopAbout] = useState('');
  const [shopType, setShopType] = useState('');
  const [shopPhone, setShopPhone] = useState('');
  const [shopLocation, setShopLocation] = useState('');
  const [shopCoords, setShopCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [catModal, setCatModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [shopPhoto, setShopPhoto] = useState<string | null>(null);
  const [photoSaving, setPhotoSaving] = useState(false);

  const handlePickPhoto = () => pickPhoto(async b64 => {
    setShopPhoto(b64);
    if (currentUser) {
      setPhotoSaving(true);
      try { await database().ref(`users/${currentUser.uid}`).update({ shopPhoto: b64 }); } catch {}
      setPhotoSaving(false);
    }
  });

  const handleSave = async () => {
    if (!shopName.trim()) { Alert.alert('Error', 'Shop name is required'); return; }
    if (shopPhone && shopPhone.replace(/\D/g, '').length < 10) {
      Alert.alert('Error', 'Please enter a valid phone number (at least 10 digits)');
      return;
    }
    setSaving(true);
    try {
      const updates: any = {
        shopName: shopName.trim(),
        shopPhoto: shopPhoto || DEFAULT_SHOP_LOGO,
        note: shopNote,
        about: shopAbout,
        type: shopType || 'Others',
        role: 'shopkeeper',
        phone: shopPhone.trim(),
        location: shopLocation.trim(),
      };
      if (shopCoords) {
        updates.latitude = shopCoords.latitude;
        updates.longitude = shopCoords.longitude;
      }
      await database().ref(`users/${currentUser!.uid}`).update(updates);
      setCurrentRole('shopkeeper');
      navigation.replace('ShopkeeperDashboard');
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setSaving(false); }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.formContainer} keyboardShouldPersistTaps="handled">
        <View style={styles.formCard}>
          <Text style={styles.formTitle}>🏪 Set up your shop</Text>
          <Text style={styles.formSub}>Complete your profile to start selling</Text>

          <TouchableOpacity style={styles.shopPhotoPickerLarge} onPress={handlePickPhoto}>
            {shopPhoto
              ? <Image source={{ uri: shopPhoto }} style={styles.shopPhotoImg} />
              : <View style={styles.photoPlaceholder}>
                  <View style={styles.cameraCircle}><Ionicons name="camera" size={32} color={BLUE} /></View>
                  <Text style={styles.photoHint}>Add shop photo</Text>
                </View>}
            {photoSaving && <View style={styles.photoOverlay}><ActivityIndicator color="white" /></View>}
          </TouchableOpacity>

          <Text style={styles.label}>Shop name *</Text>
          <TextInput style={styles.input} value={shopName} onChangeText={setShopName} placeholder="e.g. City Grocery" placeholderTextColor={TEXT_LIGHT} returnKeyType="next" />

          <Text style={styles.label}>Phone Number *</Text>
          <View style={styles.phoneInputWrap}>
            <View style={styles.phoneFlag}>
              <Text style={styles.phoneCountryCode}>🇮🇳 +91</Text>
            </View>
            <TextInput
              style={styles.phoneInput}
              value={shopPhone}
              onChangeText={setShopPhone}
              placeholder="Enter mobile number"
              placeholderTextColor={TEXT_LIGHT}
              keyboardType="phone-pad"
              returnKeyType="next"
              maxLength={15}
            />
          </View>
          <Text style={styles.phoneHint}>
            <Ionicons name="information-circle-outline" size={12} color={TEXT_LIGHT} />
            {' '}Customers can call or WhatsApp you directly
          </Text>

          <LocationPicker
            value={shopLocation}
            onChange={setShopLocation}
            onCoordsChange={(lat, lng) => setShopCoords({ latitude: lat, longitude: lng })}
            label="Shop Location *"
          />

          <Text style={styles.label}>Category</Text>
          <TouchableOpacity style={styles.picker} onPress={() => setCatModal(true)}>
            <Text style={[styles.pickerText, !shopType && { color: TEXT_LIGHT }]}>{shopType || 'Select category'}</Text>
            <Ionicons name="chevron-down" size={18} color={BLUE} />
          </TouchableOpacity>

          <Text style={styles.label}>Offer / Tagline</Text>
          <TextInput style={styles.input} value={shopNote} onChangeText={setShopNote} placeholder="e.g. Fresh items daily!" placeholderTextColor={TEXT_LIGHT} returnKeyType="next" />

          <Text style={styles.label}>About</Text>
          <TextInput style={[styles.input, styles.textArea]} multiline numberOfLines={3} value={shopAbout} onChangeText={setShopAbout} placeholder="Describe your shop…" placeholderTextColor={TEXT_LIGHT} />

          <TouchableOpacity style={[styles.btn, saving && { opacity: 0.7 }]} onPress={handleSave} disabled={saving}>
            {saving ? <ActivityIndicator size="small" color="white" /> : <Ionicons name="checkmark-circle-outline" size={20} color="white" />}
            <Text style={styles.btnText}> {saving ? 'Saving…' : 'Open Dashboard'}</Text>
          </TouchableOpacity>
        </View>

        <Modal visible={catModal} transparent animationType="slide" onRequestClose={() => setCatModal(false)}>
          <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setCatModal(false)}>
            <View style={styles.modalSheet}>
              <View style={styles.modalHandle} />
              <Text style={styles.modalTitle}>Select category</Text>
              <FlatList data={SHOP_CATEGORIES} keyExtractor={i => i}
                renderItem={({ item }) => (
                  <TouchableOpacity style={styles.modalItem} onPress={() => { setShopType(item); setCatModal(false); }}>
                    <Text style={styles.modalItemText}>{item}</Text>
                    {shopType === item && <Ionicons name="checkmark-circle" size={20} color={BLUE} />}
                  </TouchableOpacity>
                )} />
            </View>
          </TouchableOpacity>
        </Modal>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

// ── User Details Form ────────────────────────────────────────────────
const UserDetailsForm = ({ navigation }: any) => {
  const { currentUser, setCurrentRole } = React.useContext(AppContext);
  const [fullName, setFullName] = useState('');
  const [age, setAge] = useState('');
  const [gender, setGender] = useState('');
  const [phone, setPhone] = useState('');
  const [location, setLocation] = useState('');
  const [locCoords, setLocCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [userPhoto, setUserPhoto] = useState<string | null>(null);
  const [photoSaving, setPhotoSaving] = useState(false);
  const [saving, setSaving] = useState(false);

  const handlePickPhoto = () => pickPhoto(async b64 => {
    setUserPhoto(b64);
    if (currentUser) {
      setPhotoSaving(true);
      try { await database().ref(`users/${currentUser.uid}`).update({ photoURL: b64 }); } catch {}
      setPhotoSaving(false);
    }
  });

  const handleSave = async () => {
    if (saving) return;
    if (!fullName.trim()) { Alert.alert('Error', 'Name is required'); return; }
    setSaving(true);
    try {
      const updates: any = {
        fullName: fullName.trim(), age, gender, phone, location,
        photoURL: userPhoto || DEFAULT_AVATAR, role: 'user',
      };
      if (locCoords) {
        updates.latitude = locCoords.latitude;
        updates.longitude = locCoords.longitude;
      }
      await database().ref(`users/${currentUser!.uid}`).update(updates);
      setCurrentRole('user');
      if (navigation && typeof navigation.reset === 'function') {
        navigation.reset({ index: 0, routes: [{ name: 'UserDashboard' }] });
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to save your details. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.formContainer} keyboardShouldPersistTaps="handled">
        <View style={styles.formCard}>
          <Text style={styles.formTitle}>👤 Your Profile</Text>
          <Text style={styles.formSub}>Tell us a bit about yourself</Text>

          <TouchableOpacity style={styles.avatarPicker} onPress={handlePickPhoto}>
            {userPhoto
              ? <Image source={{ uri: userPhoto }} style={styles.avatarPickerImg} />
              : <View style={styles.photoPlaceholder}>
                  <View style={styles.cameraCircle}><Ionicons name="camera" size={28} color={BLUE} /></View>
                  <Text style={styles.photoHint}>Add photo</Text>
                </View>}
            {photoSaving && <View style={styles.photoOverlay}><ActivityIndicator color="white" /></View>}
          </TouchableOpacity>

          <Text style={styles.label}>Full name *</Text>
          <TextInput style={styles.input} value={fullName} onChangeText={setFullName} returnKeyType="next" placeholder="Your name" placeholderTextColor={TEXT_LIGHT} />
          <Text style={styles.label}>Age</Text>
          <TextInput style={styles.input} value={age} onChangeText={setAge} keyboardType="numeric" returnKeyType="next" placeholder="e.g. 25" placeholderTextColor={TEXT_LIGHT} />
          <Text style={styles.label}>Gender</Text>
          <View style={styles.genderRow}>
            {['Male', 'Female', 'Other'].map(g => (
              <TouchableOpacity key={g} style={[styles.genderBtn, gender === g && styles.genderBtnActive]} onPress={() => setGender(g)}>
                <Text style={[styles.genderText, gender === g && { color: 'white' }]}>{g}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.label}>Phone</Text>
          <TextInput style={styles.input} value={phone} onChangeText={setPhone} keyboardType="phone-pad" returnKeyType="next" placeholder="+91 00000 00000" placeholderTextColor={TEXT_LIGHT} />

          <LocationPicker
            value={location}
            onChange={setLocation}
            onCoordsChange={(lat, lng) => setLocCoords({ latitude: lat, longitude: lng })}
          />

          <TouchableOpacity
            style={[styles.btn, saving && { opacity: 0.7 }]}
            onPress={handleSave}
            disabled={saving}
          >
            {saving
              ? <ActivityIndicator size="small" color="white" />
              : <Ionicons name="arrow-forward-circle-outline" size={20} color="white" />}
            <Text style={styles.btnText}> {saving ? 'Saving…' : 'Continue'}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

// ── Add Product Form ─────────────────────────────────────────────────
const AddProductForm = () => {
  const { currentUser, tempProdPhoto, setTempProdPhoto } = React.useContext(AppContext);
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [price, setPrice] = useState('');
  const [note, setNote] = useState('');
  const [category, setCategory] = useState('');
  const [catModal, setCatModal] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const handleCancel = () => {
    setName(''); setQuantity(''); setPrice(''); setNote(''); setCategory(''); setTempProdPhoto(null);
  };

  const handleSubmit = async () => {
    if (!name.trim()) { Alert.alert('Error', 'Product name required'); return; }
    if (publishing) return;
    setPublishing(true);
    try {
      const prodId = database().ref('products').push().key;
      await database().ref(`products/${prodId}`).set({
        shopId: currentUser!.uid, name: name.trim(), quantity, price,
        photo: tempProdPhoto || '', note, category: category || undefined, timestamp: Date.now(),
      });
      Alert.alert('✅ Product added!');
      handleCancel();
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setPublishing(false); }
  };

  return (
    <View style={[styles.formCard, { margin: 16 }]}>
      <Text style={styles.formTitle}>📦 New Product</Text>

      <TouchableOpacity style={styles.productPhotoPicker} onPress={() => pickPhoto(b64 => setTempProdPhoto(b64))}>
        {tempProdPhoto
          ? <Image source={{ uri: tempProdPhoto }} style={styles.productPhotoImg} />
          : <View style={styles.photoPlaceholder}>
              <View style={styles.cameraCircle}><Ionicons name="camera" size={26} color={BLUE} /></View>
              <Text style={styles.photoHint}>Add photo</Text>
            </View>}
      </TouchableOpacity>

      <Text style={styles.label}>Product name *</Text>
      <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="e.g. Fresh Apples" placeholderTextColor={TEXT_LIGHT} returnKeyType="next" />
      <View style={styles.row2}>
        <View style={{ flex: 1, marginRight: 8 }}>
          <Text style={styles.label}>Quantity</Text>
          <TextInput style={styles.input} value={quantity} onChangeText={setQuantity} placeholder="1 kg, 2 pcs" placeholderTextColor={TEXT_LIGHT} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Price (₹)</Text>
          <TextInput style={styles.input} value={price} onChangeText={setPrice} keyboardType="numeric" placeholder="99" placeholderTextColor={TEXT_LIGHT} />
        </View>
      </View>
      <Text style={styles.label}>Category</Text>
      <TouchableOpacity style={styles.picker} onPress={() => setCatModal(true)}>
        <Text style={[styles.pickerText, !category && { color: TEXT_LIGHT }]}>{category || 'Select category (optional)'}</Text>
        <Ionicons name="chevron-down" size={18} color={BLUE} />
      </TouchableOpacity>
      <Text style={styles.label}>Note</Text>
      <TextInput style={[styles.input, styles.textArea]} multiline value={note} onChangeText={setNote} placeholder="Optional note" placeholderTextColor={TEXT_LIGHT} />

      <View style={styles.formActions}>
        {(name || quantity || price || category || tempProdPhoto) && (
          <TouchableOpacity style={[styles.btn, styles.btnOutline, { flex: 0.4 }]} onPress={handleCancel}>
            <Text style={[styles.btnText, { color: BLUE }]}>Clear</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={[styles.btn, { flex: 1 }, publishing && { opacity: 0.8 }]} onPress={handleSubmit} disabled={publishing}>
          {publishing ? <ActivityIndicator size="small" color="white" /> : <Ionicons name="rocket-outline" size={20} color="white" />}
          <Text style={styles.btnText}> {publishing ? 'Adding…' : 'Publish'}</Text>
        </TouchableOpacity>
      </View>

      <Modal visible={catModal} transparent animationType="slide" onRequestClose={() => setCatModal(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setCatModal(false)}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Product category</Text>
            <FlatList data={SHOP_CATEGORIES} keyExtractor={i => i}
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.modalItem} onPress={() => { setCategory(item); setCatModal(false); }}>
                  <Text style={styles.modalItemText}>{item}</Text>
                  {category === item && <Ionicons name="checkmark-circle" size={20} color={BLUE} />}
                </TouchableOpacity>
              )} />
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
};

// ── View Products List ────────────────────────────────────────────────
const ViewProductsList = ({ navigation }: any) => {
  const { currentUser } = React.useContext(AppContext);
  const [products, setProducts] = useState<{ [key: string]: Product }>({});

  useEffect(() => {
    const ref = database().ref('products').orderByChild('shopId').equalTo(currentUser!.uid);
    const l = ref.on('value', s => setProducts(s.val() || {}));
    return () => ref.off('value', l);
  }, [currentUser]);

  const handleDelete = (id: string) => Alert.alert('Delete product?', 'This cannot be undone.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: () => database().ref(`products/${id}`).remove() },
  ]);

  return (
    <View style={{ paddingHorizontal: 16 }}>
      <Text style={styles.sectionTitle}>My Products ({Object.keys(products).length})</Text>
      {Object.keys(products).length === 0
        ? <View style={styles.emptyState}>
            <Ionicons name="cube-outline" size={64} color={TEXT_LIGHT} />
            <Text style={styles.emptyText}>No products yet.</Text>
            <Text style={[styles.emptyText, { fontSize: 13 }]}>Add your first product above!</Text>
          </View>
        : Object.entries(products).map(([id, p]) => (
          <View key={id} style={styles.productCard}>
            <Image source={{ uri: p.photo || 'https://via.placeholder.com/90?text=📦' }} style={styles.productImg} />
            <View style={styles.productInfo}>
              <Text style={styles.productName} numberOfLines={1}>{p.name}</Text>
              <View style={styles.priceRow}>
                <Text style={styles.productPrice}>₹{p.price}</Text>
                <Text style={styles.productQty}>{p.quantity}</Text>
              </View>
              {p.note ? <Text style={styles.productNote} numberOfLines={1}>{p.note}</Text> : null}
              <View style={styles.productActions}>
                <TouchableOpacity style={styles.actionBtn} onPress={() => navigation.navigate('EditProduct', { productId: id, productData: p })}>
                  <Ionicons name="pencil-outline" size={13} color={BLUE} />
                  <Text style={styles.actionText}>Edit</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.actionBtn, { borderColor: '#e74c3c' }]} onPress={() => handleDelete(id)}>
                  <Ionicons name="trash-outline" size={13} color="#e74c3c" />
                  <Text style={[styles.actionText, { color: '#e74c3c' }]}>Delete</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.actionBtn, { borderColor: SUCCESS }]} onPress={() => navigation.navigate('ProductDetail', { shopId: currentUser!.uid, productId: id })}>
                  <Ionicons name="star-outline" size={13} color={SUCCESS} />
                </TouchableOpacity>
              </View>
            </View>
          </View>
        ))}
    </View>
  );
};

// ── Edit Product ─────────────────────────────────────────────────────
const EditProductForm = ({ route, navigation }: any) => {
  const { productId, productData } = route.params;
  const [name, setName] = useState(productData.name || '');
  const [quantity, setQuantity] = useState(productData.quantity || '');
  const [price, setPrice] = useState(productData.price || '');
  const [note, setNote] = useState(productData.note || '');
  const [photo, setPhoto] = useState(productData.photo || '');
  const [photoSaving, setPhotoSaving] = useState(false);

  const handlePickPhoto = () => pickPhoto(async b64 => {
    setPhoto(b64); setPhotoSaving(true);
    try { await database().ref(`products/${productId}`).update({ photo: b64 }); } catch {}
    setPhotoSaving(false);
  });

  const handleUpdate = async () => {
    await database().ref(`products/${productId}`).update({ name, quantity, price, note, photo });
    Alert.alert('✅ Updated!');
    navigation.goBack();
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.formContainer} keyboardShouldPersistTaps="handled">
        <View style={styles.formCard}>
          <Text style={styles.formTitle}>✏️ Edit Product</Text>
          <TouchableOpacity style={styles.productPhotoPicker} onPress={handlePickPhoto}>
            {photo ? <Image source={{ uri: photo }} style={styles.productPhotoImg} />
              : <View style={styles.photoPlaceholder}><View style={styles.cameraCircle}><Ionicons name="camera" size={26} color={BLUE} /></View></View>}
            {photoSaving && <View style={styles.photoOverlay}><ActivityIndicator color="white" /></View>}
          </TouchableOpacity>
          <Text style={styles.label}>Name</Text>
          <TextInput style={styles.input} value={name} onChangeText={setName} returnKeyType="next" />
          <View style={styles.row2}>
            <View style={{ flex: 1, marginRight: 8 }}>
              <Text style={styles.label}>Quantity</Text>
              <TextInput style={styles.input} value={quantity} onChangeText={setQuantity} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Price (₹)</Text>
              <TextInput style={styles.input} value={price} onChangeText={setPrice} keyboardType="numeric" />
            </View>
          </View>
          <Text style={styles.label}>Note</Text>
          <TextInput style={[styles.input, styles.textArea]} multiline value={note} onChangeText={setNote} />
          <View style={styles.formActions}>
            <TouchableOpacity style={[styles.btn, styles.btnOutline, { flex: 0.4 }]} onPress={() => navigation.goBack()}>
              <Text style={[styles.btnText, { color: BLUE }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, { flex: 1 }]} onPress={handleUpdate}>
              <Ionicons name="save-outline" size={20} color="white" /><Text style={styles.btnText}> Save</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

// ── Shopkeeper Dashboard ─────────────────────────────────────────────
const ShopkeeperDashboard = ({ navigation }: any) => {
  const { currentUser } = React.useContext(AppContext);
  const [shopData, setShopData] = useState<UserData | null>(null);
  const [activeTab, setActiveTab] = useState<'add' | 'view'>('add');

  useEffect(() => {
    const ref = database().ref(`users/${currentUser!.uid}`);
    const l = ref.on('value', s => setShopData(s.val()));
    return () => ref.off('value', l);
  }, [currentUser]);

  const handleLogout = async () => {
    await auth().signOut();
    navigation.reset({ index: 0, routes: [{ name: 'Auth' }] });
  };

  return (
    <View style={styles.screen}>
      <DashboardBackground />

      {/* Blue header zone with navbar + banner */}
      <View style={styles.blueHeaderZone}>
        <View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: DEEP_BLUE }} />
        <FloatingBubbles count={8} />
        <View style={{ position: 'absolute', top: -60, right: -40, width: 200, height: 200, borderRadius: 100, backgroundColor: 'rgba(30,100,255,0.18)' }} />
        <View style={{ position: 'absolute', top: 40, left: -50, width: 150, height: 150, borderRadius: 75, backgroundColor: 'rgba(10,50,200,0.15)' }} />

        {/* Navbar inside blue zone */}
        <View style={styles.navbarInner}>
          <View>
            <Text style={styles.navTitle}>My Shop</Text>
            <Text style={styles.navSub}>{shopData?.shopName || '…'}</Text>
          </View>
          <View style={styles.navRight}>
            <TouchableOpacity style={styles.navIconBtn} onPress={() => navigation.navigate('Profile')}>
              <Image source={{ uri: shopData?.shopPhoto || DEFAULT_SHOP_LOGO }} style={styles.navAvatar} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Shop banner inside blue zone */}
        {shopData && (
          <View style={styles.shopBannerBlue}>
            <Image source={{ uri: shopData.shopPhoto || DEFAULT_SHOP_LOGO }} style={styles.shopBannerImg} />
            <View style={{ flex: 1 }}>
              <Text style={styles.shopBannerNameWhite}>{shopData.shopName}</Text>
              <View style={styles.typePillLight}>
                <Text style={styles.typePillLightText}>{shopData.type || 'General'}</Text>
              </View>
              {shopData.note ? <Text style={styles.shopBannerNoteWhite}>{shopData.note}</Text> : null}
              {shopData.phone ? (
                <View style={styles.locationRow}>
                  <Ionicons name="call-outline" size={11} color="rgba(255,255,255,0.8)" />
                  <Text style={[styles.shopLocationText, { color: 'rgba(255,255,255,0.8)' }]}>{shopData.phone}</Text>
                </View>
              ) : null}
            </View>
            <TouchableOpacity style={styles.editFabLight} onPress={() => navigation.navigate('EditProfile')}>
              <Ionicons name="pencil" size={15} color={DEEP_BLUE} />
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.blueHeaderWave} />
      </View>

      <View style={styles.segControl}>
        {(['add', 'view'] as const).map(t => (
          <TouchableOpacity key={t} style={[styles.segBtn, activeTab === t && styles.segBtnActive]} onPress={() => setActiveTab(t)}>
            <Ionicons name={t === 'add' ? 'add-circle-outline' : 'grid-outline'} size={16} color={activeTab === t ? 'white' : BLUE} />
            <Text style={[styles.segText, activeTab === t && styles.segTextActive]}>
              {t === 'add' ? 'Add Product' : 'My Products'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 100 }} keyboardShouldPersistTaps="handled">
        {activeTab === 'add' ? <AddProductForm /> : <ViewProductsList navigation={navigation} />}
      </ScrollView>

      <View style={styles.bottomBar}>
        <NavItem icon="storefront" label="Shop" active />
        <NavItem icon="person-circle-outline" label="Profile" onPress={() => navigation.navigate('Profile')} />
        <NavItem icon="log-out-outline" label="Logout" onPress={handleLogout} />
      </View>
    </View>
  );
};

// ── User Dashboard ── WITH LOCATION + PROXIMITY SORT + CITY FILTER ───
const UserDashboard = ({ navigation }: any) => {
  const { currentUser } = React.useContext(AppContext);
  const [userData, setUserData] = useState<UserData | null>(null);
  const [shops, setShops] = useState<{ [key: string]: UserData }>(GlobalStore.shops);
  const [shopsLoaded, setShopsLoaded] = useState(Object.keys(GlobalStore.shops).length > 0);
  const [searchTerm, setSearchTerm] = useState('');
  const [cartCount, setCartCount] = useState(GlobalStore.cartCount);
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(GlobalStore.userLocation);
  const [detectingLoc, setDetectingLoc] = useState(false);
  const [selectedCity, setSelectedCity] = useState<string>('All');
  const [cityModalVisible, setCityModalVisible] = useState(false);

  // Auto-detect location on mount
  useEffect(() => {
    if (!GlobalStore.userLocation) {
      (async () => {
        const granted = await requestLocationPermission();
        if (granted) {
          try {
            const pos = await getCurrentLocation();
            const loc = { latitude: pos.latitude, longitude: pos.longitude };
            GlobalStore.userLocation = loc;
            setUserLocation(loc);
          } catch {}
        }
      })();
    }
  }, []);

  useEffect(() => {
    const userRef = database().ref(`users/${currentUser!.uid}`);
    const ul = userRef.on('value', s => {
      const d = s.val();
      setUserData(d);
      if (!GlobalStore.userLocation && d?.latitude && d?.longitude) {
        const loc = { latitude: d.latitude, longitude: d.longitude };
        GlobalStore.userLocation = loc;
        setUserLocation(loc);
      }
    });

    const shopsRef = database().ref('users').orderByChild('role').equalTo('shopkeeper');
    const sl = shopsRef.on('value', snap => {
      const data: { [key: string]: UserData } = snap.val() || {};
      GlobalStore.shops = data;
      setShops(data);
      setShopsLoaded(true);
      Object.keys(data).forEach(shopId => {
        database().ref('products').orderByChild('shopId').equalTo(shopId).once('value')
          .then(ps => { GlobalStore.products[shopId] = ps.val() || {}; })
          .catch(() => {});
      });
    });

    const cartRef = database().ref(`carts/${currentUser!.uid}`);
    const cl = cartRef.on('value', s => {
      const v = s.val(); const count = v ? Object.keys(v).length : 0;
      GlobalStore.cartCount = count; setCartCount(count);
    });

    return () => {
      userRef.off('value', ul);
      shopsRef.off('value', sl);
      cartRef.off('value', cl);
    };
  }, [currentUser]);

  // Derive city options from all shops
  const cityOptions = useMemo(() => {
    const cities = new Set<string>();
    Object.values(shops).forEach(s => { if (s.location?.trim()) cities.add(s.location.trim()); });
    return ['All', ...Array.from(cities).sort()];
  }, [shops]);

  // Filtered + proximity-sorted shops
  const filteredShops = useMemo(() => {
    const list = Object.entries(shops)
      .filter(([, s]) => {
        const q = searchTerm.toLowerCase();
        const matchSearch = !q ||
          s.shopName?.toLowerCase().includes(q) ||
          s.type?.toLowerCase().includes(q) ||
          s.location?.toLowerCase().includes(q);
        const matchCity = selectedCity === 'All' ||
          s.location?.toLowerCase().trim() === selectedCity.toLowerCase().trim();
        return matchSearch && matchCity;
      })
      .map(([id, s]) => {
        const distanceKm = (userLocation && s.latitude && s.longitude)
          ? haversineKm(userLocation.latitude, userLocation.longitude, s.latitude, s.longitude)
          : undefined;
        return { id, ...s, distanceKm };
      });

    // Sort: nearest first, then alphabetical
    list.sort((a, b) => {
      if (a.distanceKm !== undefined && b.distanceKm !== undefined) return a.distanceKm - b.distanceKm;
      if (a.distanceKm !== undefined) return -1;
      if (b.distanceKm !== undefined) return 1;
      return (a.shopName || '').localeCompare(b.shopName || '');
    });
    return list;
  }, [shops, searchTerm, selectedCity, userLocation]);

  const handleDetectLocation = async () => {
    setDetectingLoc(true);
    try {
      const granted = await requestLocationPermission();
      if (!granted) { Alert.alert('Permission denied', 'Allow location access in settings.'); return; }
      const pos = await getCurrentLocation();
      const loc = { latitude: pos.latitude, longitude: pos.longitude };
      GlobalStore.userLocation = loc;
      setUserLocation(loc);
      const updates: any = { latitude: pos.latitude, longitude: pos.longitude };
      if (pos.cityName) updates.location = pos.cityName;
      await database().ref(`users/${currentUser!.uid}`).update(updates);
      Alert.alert('✅ Location updated', pos.cityName ? `You are in ${pos.cityName}` : 'Location set!');
    } catch { Alert.alert('Error', 'Could not detect location.'); }
    finally { setDetectingLoc(false); }
  };

  const openShop = useCallback((shopId: string, shopData: UserData) => {
    Keyboard.dismiss();
    navigation.navigate('ShopProducts', { shopId, shopData, cachedProducts: GlobalStore.products[shopId] ?? null });
  }, [navigation]);

  const renderShopItem = useCallback(({ item, index }: { item: any; index: number }) => (
    <AnimatedShopCard
      _shopId={item.id}
      shop={item}
      index={index}
      distanceKm={item.distanceKm}
      onPress={() => openShop(item.id, item)}
    />
  ), [openShop]);

  const keyExtractor = useCallback((item: any) => item.id, []);

  const ListEmpty = !shopsLoaded
    ? <View>{[1,2,3].map(i => <ShopCardSkeleton key={i} />)}</View>
    : <View style={styles.emptyState}>
        <Ionicons name="storefront-outline" size={64} color={TEXT_LIGHT} />
        <Text style={styles.emptyText}>No shops found</Text>
        {selectedCity !== 'All' && (
          <TouchableOpacity onPress={() => setSelectedCity('All')} style={[styles.smallBtn, { alignSelf: 'center', marginTop: 12 }]}>
            <Text style={styles.smallBtnText}>Show all areas</Text>
          </TouchableOpacity>
        )}
      </View>;

  return (
    <View style={styles.screen}>
      <DashboardBackground />

      <FlatList
        data={filteredShops}
        keyExtractor={keyExtractor}
        renderItem={renderShopItem}
        ListEmptyComponent={ListEmpty}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
        removeClippedSubviews={true}
        maxToRenderPerBatch={8}
        windowSize={10}
        initialNumToRender={6}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View>
            {/* Blue header zone */}
            <View style={[styles.blueHeaderZone, { marginHorizontal: -16 }]}>
              <View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: DEEP_BLUE }} />
              <View style={{ position: 'absolute', top: -60, right: -40, width: 220, height: 220, borderRadius: 110, backgroundColor: 'rgba(30,100,255,0.2)' }} />
              <View style={{ position: 'absolute', top: 50, left: -40, width: 160, height: 160, borderRadius: 80, backgroundColor: 'rgba(10,50,200,0.15)' }} />
              <FloatingBubbles count={8} />
              <View style={[styles.navbarInner, { position: 'relative' }]}>
                <View style={[StyleSheet.absoluteFillObject, { justifyContent: 'center', alignItems: 'center', pointerEvents: 'box-none' }]}>
                  <Text style={[styles.navTitle, { flex: 0 }]}>CityLinks</Text>
                  <Text style={[styles.navSub, { textAlign: 'center' }]}>Find shops near you</Text>
                </View>
                <View style={[styles.navRight, { flex: 1, justifyContent: 'flex-end' }]}>
                  <TouchableOpacity style={styles.navIconBtn} onPress={() => navigation.navigate('Cart')}>
                    <Ionicons name="cart-outline" size={24} color="white" />
                    {cartCount > 0 && <View style={styles.badge}><Text style={styles.badgeText}>{cartCount > 9 ? '9+' : cartCount}</Text></View>}
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => navigation.navigate('Profile')}>
                    <Image source={{ uri: userData?.photoURL || DEFAULT_AVATAR }} style={styles.navAvatar} />
                  </TouchableOpacity>
                </View>
              </View>
              <View style={styles.welcomeInner}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.welcomeGreeting}>👋 Hello, {userData?.fullName?.split(' ')[0] || 'there'}!</Text>
                  <TouchableOpacity style={styles.locationDetectRow} onPress={handleDetectLocation} disabled={detectingLoc}>
                    {detectingLoc
                      ? <ActivityIndicator size="small" color="rgba(255,255,255,0.8)" />
                      : <Ionicons name="locate-outline" size={13} color="rgba(255,255,255,0.9)" />}
                    <Text style={styles.welcomeLocation} numberOfLines={1}>
                      {userData?.location || 'Tap to detect location'}
                    </Text>
                  </TouchableOpacity>
                </View>
                <TouchableOpacity style={styles.editFabLight} onPress={() => navigation.navigate('EditProfile')}>
                  <Ionicons name="pencil" size={15} color={DEEP_BLUE} />
                </TouchableOpacity>
              </View>
              <View style={styles.blueHeaderWave} />
            </View>

            {/* Search */}
            <View style={styles.searchBar}>
              <Ionicons name="search-outline" size={18} color={TEXT_MID} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search shops or categories…"
                placeholderTextColor={TEXT_LIGHT}
                value={searchTerm}
                onChangeText={setSearchTerm}
              />
              {searchTerm ? <TouchableOpacity onPress={() => setSearchTerm('')}><Ionicons name="close-circle" size={18} color={TEXT_LIGHT} /></TouchableOpacity> : null}
            </View>

            {/* Filter bar */}
            <View style={styles.filterBarRow}>
              <TouchableOpacity style={styles.cityFilterBtn} onPress={() => setCityModalVisible(true)}>
                <Ionicons name="location" size={14} color={BLUE} />
                <Text style={styles.cityFilterText} numberOfLines={1}>
                  {selectedCity === 'All' ? 'All Areas' : selectedCity}
                </Text>
                <Ionicons name="chevron-down" size={14} color={BLUE} />
              </TouchableOpacity>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={styles.sectionTitleLarge}>
                  🏪 {shopsLoaded ? `${filteredShops.length} Shop${filteredShops.length !== 1 ? 's' : ''}` : 'Shops'}
                </Text>
                {userLocation && (
                  <View style={[styles.callHintPill, { backgroundColor: '#e6f4ea' }]}>
                    <Ionicons name="navigate" size={10} color={SUCCESS} />
                    <Text style={[styles.callHintText, { color: SUCCESS }]}>Nearest first</Text>
                  </View>
                )}
              </View>
            </View>
          </View>
        }
      />

      <View style={styles.bottomBar}>
        <NavItem icon="home" label="Home" active />
        <NavItem icon="cart-outline" label="Cart" onPress={() => navigation.navigate('Cart')} badge={cartCount} />
        <NavItem icon="person-outline" label="Profile" onPress={() => navigation.navigate('Profile')} />
      </View>

      {/* City Filter Modal */}
      <Modal visible={cityModalVisible} transparent animationType="slide" onRequestClose={() => setCityModalVisible(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setCityModalVisible(false)}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>📍 Filter by Area</Text>
            <FlatList
              data={cityOptions}
              keyExtractor={i => i}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.modalItem, selectedCity === item && { backgroundColor: '#e8f0fe' }]}
                  onPress={() => { setSelectedCity(item); setCityModalVisible(false); }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <Ionicons name={item === 'All' ? 'globe-outline' : 'location-outline'} size={16} color={selectedCity === item ? BLUE : TEXT_MID} />
                    <Text style={[styles.modalItemText, selectedCity === item && { color: BLUE, fontWeight: '700' }]}>{item}</Text>
                  </View>
                  {selectedCity === item && <Ionicons name="checkmark-circle" size={20} color={BLUE} />}
                </TouchableOpacity>
              )}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
};


// ── Shop Products ─────────────────────────────────────────────────────
const ShopProducts = ({ route, navigation }: any) => {
  const shopId: string = route.params?.shopId ?? '';
  const shopDataParam: UserData = route.params?.shopData ?? {};
  const cachedProducts = route.params?.cachedProducts;

  const [shop, setShop] = useState<UserData>(shopDataParam);
  const [products, setProducts] = useState<{ [key: string]: Product }>(cachedProducts || {});
  const [productsLoaded, setProductsLoaded] = useState(!!cachedProducts);
  const [searchTerm, setSearchTerm] = useState('');
  const [priceSort, setPriceSort] = useState<'none' | 'low' | 'high'>('none');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [filterVisible, setFilterVisible] = useState(false);

  useEffect(() => {
    if (!shopId) return;
    const shopRef = database().ref(`users/${shopId}`);
    const sl = shopRef.on('value', s => { if (s.val()) setShop(s.val()); });

    const prodRef = database().ref('products').orderByChild('shopId').equalTo(shopId);
    const pl = prodRef.on('value', s => {
      const data = s.val() || {};
      setProducts(data);
      GlobalStore.products[shopId] = data;
      setProductsLoaded(true);
    });
    return () => { shopRef.off('value', sl); prodRef.off('value', pl); };
  }, [shopId]);

  const filtered = useMemo(() => {
    let list = Object.entries(products).filter(([, p]) =>
      p.name.toLowerCase().includes(searchTerm.toLowerCase()));
    if (categoryFilter !== 'All') list = list.filter(([, p]) => (p.category || '') === categoryFilter);
    if (priceSort === 'low') list = [...list].sort((a, b) => Number(a[1].price) - Number(b[1].price));
    else if (priceSort === 'high') list = [...list].sort((a, b) => Number(b[1].price) - Number(a[1].price));
    return list;
  }, [products, searchTerm, categoryFilter, priceSort]);

  return (
    <View style={styles.screen}>
      <DashboardBackground />

      {/* Blue header zone */}
      <View style={[styles.blueHeaderZone, { paddingBottom: shop?.phone ? 52 : 44 }]}>
        <View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: DEEP_BLUE }} />
        <View style={{ position: 'absolute', top: -40, right: -40, width: 180, height: 180, borderRadius: 90, backgroundColor: 'rgba(30,100,255,0.18)' }} />
        <FloatingBubbles count={6} />

        <View style={styles.navbarInner}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="arrow-back" size={22} color="white" />
          </TouchableOpacity>
          <Text style={styles.navTitle} numberOfLines={1}>{shop?.shopName || 'Shop'}</Text>
          <View style={{ width: 32 }} />
        </View>

        {shop && (
          <View style={styles.shopBannerBlue}>
            <Image source={{ uri: shop.shopPhoto || DEFAULT_SHOP_LOGO }} style={styles.shopBannerImg} />
            <View style={{ flex: 1 }}>
              <Text style={styles.shopBannerNameWhite}>{shop.shopName}</Text>
              <View style={styles.typePillLight}><Text style={styles.typePillLightText}>{shop.type || 'General'}</Text></View>
              {shop.note ? <Text style={styles.shopBannerNoteWhite}>{shop.note}</Text> : null}
              {shop.phone && (
                <View style={styles.bannerContactRow}>
                  <TouchableOpacity style={styles.bannerContactBtn} onPress={() => handleCall(shop.phone!)}>
                    <Ionicons name="call" size={13} color="white" />
                    <Text style={styles.bannerContactText}>Call</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.bannerContactBtn, { backgroundColor: WHATSAPP_GREEN }]} onPress={() => handleWhatsApp(shop.phone!)}>
                    <Ionicons name="logo-whatsapp" size={13} color="white" />
                    <Text style={styles.bannerContactText}>WhatsApp</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </View>
        )}

        <View style={styles.blueHeaderWave} />
      </View>

      <View style={styles.searchFilterRow}>
        <View style={[styles.searchBar, { flex: 1, margin: 0 }]}>
          <Ionicons name="search-outline" size={16} color={TEXT_MID} />
          <TextInput style={styles.searchInput} placeholder="Search products…"
            placeholderTextColor={TEXT_LIGHT} value={searchTerm} onChangeText={setSearchTerm} />
        </View>
        <TouchableOpacity style={[styles.filterBtn, filterVisible && styles.filterBtnActive]}
          onPress={() => setFilterVisible(!filterVisible)}>
          <Ionicons name="options-outline" size={20} color={filterVisible ? 'white' : BLUE} />
        </TouchableOpacity>
      </View>

      {filterVisible && (
        <View style={styles.filterPanel}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
            {['All', ...SHOP_CATEGORIES].map(cat => (
              <TouchableOpacity key={cat} style={[styles.chip, categoryFilter === cat && styles.chipActive]}
                onPress={() => setCategoryFilter(cat)}>
                <Text style={[styles.chipText, categoryFilter === cat && styles.chipTextActive]}>{cat}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <View style={styles.chipRow}>
            {(['none', 'low', 'high'] as const).map(opt => (
              <TouchableOpacity key={opt} style={[styles.chip, priceSort === opt && styles.chipActive]}
                onPress={() => setPriceSort(opt)}>
                <Text style={[styles.chipText, priceSort === opt && styles.chipTextActive]}>
                  {opt === 'none' ? 'Default' : opt === 'low' ? '↑ Price' : '↓ Price'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100 }}>
        {!productsLoaded
          ? [1,2,3].map(i => (
              <View key={i} style={[styles.productCard, { gap: 12 }]}>
                <SkeletonBox w={84} h={84} r={16} />
                <View style={{ flex: 1, gap: 8 }}>
                  <SkeletonBox w="70%" h={16} r={6} />
                  <SkeletonBox w="40%" h={14} r={6} />
                </View>
              </View>
            ))
          : filtered.length === 0
            ? <View style={styles.emptyState}>
                <Ionicons name="cube-outline" size={64} color={TEXT_LIGHT} />
                <Text style={styles.emptyText}>No products found</Text>
              </View>
            : filtered.map(([prodId, p]) => (
              <TouchableOpacity key={prodId} style={styles.productCard}
                onPress={() => navigation.navigate('ProductDetail', { shopId, productId: prodId, productData: p, shopData: shop })}>
                <Image source={{ uri: p.photo || 'https://via.placeholder.com/90?text=📦' }} style={styles.productImg} />
                <View style={styles.productInfo}>
                  <Text style={styles.productName} numberOfLines={1}>{p.name}</Text>
                  <View style={styles.priceRow}>
                    <Text style={styles.productPrice}>₹{p.price}</Text>
                    <Text style={styles.productQty}>{p.quantity}</Text>
                  </View>
                  {p.note ? <Text style={styles.productNote} numberOfLines={1}>{p.note}</Text> : null}
                  <TouchableOpacity style={styles.addCartBtn} onPress={e => { e.stopPropagation(); addToCart(prodId, shopId); }}>
                    <Ionicons name="cart-outline" size={13} color="white" />
                    <Text style={styles.addCartText}>Add to Cart</Text>
                  </TouchableOpacity>
                </View>
              </TouchableOpacity>
            ))}
      </ScrollView>

      <View style={styles.bottomBar}>
        <NavItem icon="home-outline" label="Home" onPress={() => navigation.navigate('UserDashboard')} />
        <NavItem icon="cart-outline" label="Cart" onPress={() => navigation.navigate('Cart')} badge={GlobalStore.cartCount} />
        <NavItem icon="person-outline" label="Profile" onPress={() => navigation.navigate('Profile')} />
      </View>
    </View>
  );
};

// ── Product Detail ───────────────────────────────────────────────────
const ProductDetail = ({ route, navigation }: any) => {
  const { shopId, productId } = route.params;
  const productDataParam = route.params?.productData;
  const shopDataParam = route.params?.shopData;
  const { currentUser } = React.useContext(AppContext);
  const [product, setProduct] = useState<Product | null>(productDataParam || null);
  const [shop, setShop] = useState<UserData | null>(shopDataParam || null);
  const [reviews, setReviews] = useState<{ [key: string]: Review }>({});
  const [queries, setQueries] = useState<{ [key: string]: QueryItem }>({});
  const [selectedRating, setSelectedRating] = useState(0);
  const [reviewComment, setReviewComment] = useState('');
  const [newQuestion, setNewQuestion] = useState('');
  const [answerTexts, setAnswerTexts] = useState<{ [key: string]: string }>({});
  const isShopOwner = currentUser?.uid === shopId;

  useEffect(() => {
    const refs = [
      [database().ref(`products/${productId}`), (s: any) => { if (s.val()) setProduct(s.val()); }],
      [database().ref(`users/${shopId}`), (s: any) => { if (s.val()) setShop(s.val()); }],
      [database().ref(`reviews/${productId}`), (s: any) => setReviews(s.val() || {})],
      [database().ref(`queries/${productId}`), (s: any) => setQueries(s.val() || {})],
    ] as any[];
    const ls = refs.map(([ref, cb]) => { const l = ref.on('value', cb); return [ref, l]; });
    return () => ls.forEach(([ref, l]) => ref.off('value', l));
  }, [productId, shopId]);

  const submitReview = async () => {
    if (!currentUser) return Alert.alert('Please login');
    if (!selectedRating) return Alert.alert('Select a rating first');
    const snap = await database().ref(`users/${currentUser.uid}`).once('value');
    const u = snap.val() || {};
    await database().ref(`reviews/${productId}/${currentUser.uid}`).set({
      rating: selectedRating, comment: reviewComment, timestamp: Date.now(),
      userName: u.fullName || u.shopName || 'User',
    });
    Alert.alert('✅ Review submitted!');
    setSelectedRating(0); setReviewComment('');
  };

  const submitQuery = async () => {
    if (!newQuestion.trim()) return Alert.alert('Enter a question');
    const snap = await database().ref(`users/${currentUser!.uid}`).once('value');
    const u = snap.val() || {};
    await database().ref(`queries/${productId}`).push({
      userId: currentUser!.uid, userName: u.fullName || u.shopName || 'Customer',
      question: newQuestion, answer: '', timestamp: Date.now(), answerTimestamp: null, answeredBy: null,
    });
    setNewQuestion('');
  };

  const answerQuery = async (qid: string) => {
    const a = answerTexts[qid];
    if (!a?.trim()) return;
    await database().ref(`queries/${productId}/${qid}`).update({ answer: a, answerTimestamp: Date.now(), answeredBy: currentUser!.uid });
    setAnswerTexts(p => ({ ...p, [qid]: '' }));
  };

  if (!product) return <View style={styles.loadingScreen}><ActivityIndicator size="large" color={BLUE} /></View>;

  const revArr = Object.values(reviews);
  const avgRating = revArr.length ? (revArr.reduce((a, r) => a + r.rating, 0) / revArr.length).toFixed(1) : null;

  return (
    <ScrollView style={[styles.screen, { paddingTop: 0 }]}>
      <View style={styles.navbarBlue}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="arrow-back" size={22} color="white" />
        </TouchableOpacity>
        <Text style={styles.navTitle} numberOfLines={1}>{product.name}</Text>
        <View style={{ width: 32 }} />
      </View>

      <View style={styles.detailCard}>
        <Image source={{ uri: product.photo || 'https://via.placeholder.com/300?text=📦' }} style={styles.detailImg} />
        <View style={styles.detailBody}>
          <Text style={styles.detailName}>{product.name}</Text>
          <View style={styles.priceRow}>
            <Text style={styles.detailPrice}>₹{product.price}</Text>
            <Text style={styles.productQty}>{product.quantity}</Text>
          </View>
          {product.note ? <Text style={styles.productNote}>{product.note}</Text> : null}
          <Text style={styles.shopRef}>🏪 {shop?.shopName || 'Loading…'}</Text>
          {!isShopOwner && currentUser && (
            <TouchableOpacity style={styles.addCartBtnLg} onPress={() => addToCart(productId, shopId)}>
              <Ionicons name="cart-outline" size={18} color="white" />
              <Text style={[styles.btnText, { marginLeft: 8 }]}>Add to Cart</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Reviews */}
      <View style={styles.sectionCard}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>⭐ Reviews</Text>
          {avgRating && <View style={styles.ratingPill}><Text style={styles.ratingPillText}>{avgRating} / 5</Text></View>}
        </View>
        {revArr.length === 0 && <Text style={styles.emptyText}>No reviews yet. Be first!</Text>}
        {Object.entries(reviews).map(([uid, rev]) => (
          <View key={uid} style={styles.reviewCard}>
            <View style={styles.reviewTop}>
              <Text style={styles.reviewUser}>{rev.userName}</Text>
              <Text style={styles.reviewStars}>{'★'.repeat(rev.rating)}{'☆'.repeat(5 - rev.rating)}</Text>
            </View>
            {rev.comment ? <Text style={styles.reviewComment}>{rev.comment}</Text> : null}
            {isShopOwner && (
              <TouchableOpacity onPress={() => database().ref(`reviews/${productId}/${uid}`).remove()} style={{ alignSelf: 'flex-end', marginTop: 4 }}>
                <Ionicons name="trash-outline" size={16} color="#e74c3c" />
              </TouchableOpacity>
            )}
          </View>
        ))}
        {!isShopOwner && currentUser && (
          <View style={styles.addReview}>
            <Text style={styles.subSectionTitle}>Leave a Review</Text>
            <View style={styles.starRow}>
              {[1,2,3,4,5].map(i => (
                <TouchableOpacity key={i} onPress={() => setSelectedRating(i)}>
                  <Ionicons name={i <= selectedRating ? 'star' : 'star-outline'} size={30} color="#ffb82e" />
                </TouchableOpacity>
              ))}
            </View>
            <TextInput style={[styles.input, { height: 72, textAlignVertical: 'top' }]}
              placeholder="Your thoughts…" multiline value={reviewComment} onChangeText={setReviewComment} />
            <TouchableOpacity style={styles.smallBtn} onPress={submitReview}>
              <Ionicons name="send-outline" size={14} color="white" />
              <Text style={styles.smallBtnText}> Submit</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Q&A */}
      <View style={[styles.sectionCard, { marginBottom: 32 }]}>
        <Text style={styles.sectionTitle}>💬 Q&A</Text>
        {Object.keys(queries).length === 0 && <Text style={styles.emptyText}>No questions yet.</Text>}
        {Object.entries(queries).map(([qid, q]) => (
          <View key={qid} style={styles.qCard}>
            <Text style={styles.qUser}>{q.userName}</Text>
            <Text style={styles.qQuestion}>Q: {q.question}</Text>
            {q.answer
              ? <View style={styles.answerBox}><Text style={styles.answerText}>A: {q.answer}</Text></View>
              : isShopOwner
                ? <>
                    <TextInput style={[styles.input, { marginTop: 8 }]} placeholder="Write your answer…"
                      value={answerTexts[qid] || ''} onChangeText={t => setAnswerTexts(p => ({ ...p, [qid]: t }))} />
                    <TouchableOpacity style={styles.smallBtn} onPress={() => answerQuery(qid)}>
                      <Text style={styles.smallBtnText}>Post Answer</Text>
                    </TouchableOpacity>
                  </>
                : <Text style={styles.awaitingText}>⏳ Awaiting shopkeeper reply</Text>}
          </View>
        ))}
        {!isShopOwner && currentUser && (
          <View style={styles.addReview}>
            <Text style={styles.subSectionTitle}>Ask a Question</Text>
            <TextInput style={[styles.input, { height: 72, textAlignVertical: 'top' }]}
              placeholder="Type your question…" multiline value={newQuestion} onChangeText={setNewQuestion} />
            <TouchableOpacity style={styles.smallBtn} onPress={submitQuery}>
              <Ionicons name="chatbubble-outline" size={14} color="white" />
              <Text style={styles.smallBtnText}> Ask</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </ScrollView>
  );
};

const addToCart = async (productId: string, shopId: string) => {
  const user = auth().currentUser;
  if (!user) return Alert.alert('Please login to add to cart');
  await database().ref(`carts/${user.uid}/${productId}`).set({ productId, shopId, added: Date.now() });
  Alert.alert('✅ Added to cart!');
};

// ── Cart Screen ──────────────────────────────────────────────────────
const CartScreen = ({ navigation }: any) => {
  const { currentUser } = React.useContext(AppContext);
  const [cartItems, setCartItems] = useState<{ [k: string]: any }>({});
  const [products, setProducts] = useState<{ [k: string]: Product }>({});
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const cartRef = database().ref(`carts/${currentUser!.uid}`);
    const l = cartRef.on('value', async snap => {
      const cart = snap.val() || {};
      setCartItems(cart);
      let sum = 0;
      const map: { [k: string]: Product } = {};
      await Promise.all(Object.keys(cart).map(async pid => {
        const ps = await database().ref(`products/${pid}`).once('value');
        const p = ps.val();
        if (p) { map[pid] = p; sum += Number(p.price) || 0; }
      }));
      setProducts(map); setTotal(sum); setLoading(false);
    });
    return () => cartRef.off('value', l);
  }, [currentUser]);

  return (
    <View style={styles.screen}>
      <DashboardBackground />
      <View style={styles.navbarBlue}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="arrow-back" size={22} color="white" />
        </TouchableOpacity>
        <Text style={styles.navTitle}>My Cart</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 130 }}>
        {loading
          ? [1,2].map(i => <View key={i} style={[styles.productCard, { gap: 12 }]}><SkeletonBox w={76} h={76} r={16} /><View style={{ flex: 1, gap: 8 }}><SkeletonBox w="60%" h={16} r={6} /><SkeletonBox w="40%" h={14} r={6} /></View></View>)
          : Object.keys(cartItems).length === 0
            ? <View style={styles.emptyState}><Ionicons name="cart-outline" size={72} color={TEXT_LIGHT} /><Text style={styles.emptyText}>Your cart is empty</Text></View>
            : Object.keys(cartItems).map(prodId => {
                const p = products[prodId]; if (!p) return null;
                return (
                  <View key={prodId} style={styles.productCard}>
                    <Image source={{ uri: p.photo || 'https://via.placeholder.com/90' }} style={styles.productImg} />
                    <View style={styles.productInfo}>
                      <Text style={styles.productName} numberOfLines={1}>{p.name}</Text>
                      <Text style={styles.productPrice}>₹{p.price}</Text>
                      <TouchableOpacity style={styles.removeBtn} onPress={() => database().ref(`carts/${currentUser!.uid}/${prodId}`).remove()}>
                        <Ionicons name="trash-outline" size={14} color="#e74c3c" />
                        <Text style={styles.removeBtnText}> Remove</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })}
      </ScrollView>

      {Object.keys(cartItems).length > 0 && !loading && (
        <View style={styles.checkoutBar}>
          <View>
            <Text style={styles.totalLabel}>Total Amount</Text>
            <Text style={styles.totalAmount}>₹{total}</Text>
          </View>
          <TouchableOpacity style={[styles.btn, { marginTop: 0, flex: 0.55 }]}>
            <Ionicons name="bag-check-outline" size={18} color="white" />
            <Text style={styles.btnText}> Checkout</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.bottomBar}>
        <NavItem icon="home-outline" label="Home" onPress={() => navigation.navigate('UserDashboard')} />
        <NavItem icon="cart" label="Cart" active />
        <NavItem icon="person-outline" label="Profile" onPress={() => navigation.navigate('Profile')} />
      </View>
    </View>
  );
};

// ── Profile ──────────────────────────────────────────────────────────
const ProfileScreen = ({ navigation }: any) => {
  const { currentUser, currentRole } = React.useContext(AppContext);
  const [userData, setUserData] = useState<UserData | null>(null);

  useEffect(() => {
    const ref = database().ref(`users/${currentUser!.uid}`);
    const l = ref.on('value', s => setUserData(s.val()));
    return () => ref.off('value', l);
  }, [currentUser]);

  const photo = currentRole === 'shopkeeper' ? userData?.shopPhoto || DEFAULT_SHOP_LOGO : userData?.photoURL || DEFAULT_AVATAR;
  const name = currentRole === 'shopkeeper' ? userData?.shopName : userData?.fullName;

  return (
    <ScrollView style={[styles.screen, { paddingTop: 0 }]} contentContainerStyle={{ paddingBottom: 40 }}>
      <View style={styles.navbarBlue}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="arrow-back" size={22} color="white" />
        </TouchableOpacity>
        <Text style={styles.navTitle}>Profile</Text>
        <View style={{ width: 32 }} />
      </View>

      <View style={styles.profileHero}>
        <View style={styles.profileAvatarWrap}>
          <Image source={{ uri: photo }} style={styles.profileAvatar} />
          <TouchableOpacity style={styles.profileAvatarEdit} onPress={() => navigation.navigate('EditProfile')}>
            <Ionicons name="camera" size={14} color="white" />
          </TouchableOpacity>
        </View>
        <Text style={styles.profileName}>{name || 'User'}</Text>
        <Text style={styles.profileEmail}>{userData?.email || currentUser?.email}</Text>
        <View style={[styles.typePillLight, { marginTop: 8, alignSelf: 'center' }]}>
          <Text style={styles.typePillLightText}>{currentRole === 'shopkeeper' ? '🏪 Shopkeeper' : '🛍️ Customer'}</Text>
        </View>
      </View>

      <View style={[styles.formCard, { margin: 16 }]}>
        <Text style={styles.formTitle}>{currentRole === 'shopkeeper' ? 'Shop Info' : 'Personal Info'}</Text>
        {currentRole === 'shopkeeper'
          ? <><InfoRow label="Shop name" value={userData?.shopName} /><InfoRow label="Category" value={userData?.type} /><InfoRow label="About" value={userData?.about} /><InfoRow label="Offer note" value={userData?.note} /><InfoRow label="Phone" value={userData?.phone} /></>
          : <><InfoRow label="Full name" value={userData?.fullName} /><InfoRow label="Age" value={userData?.age} /><InfoRow label="Gender" value={userData?.gender} /><InfoRow label="Phone" value={userData?.phone} /><InfoRow label="Location" value={userData?.location} /></>}
        <TouchableOpacity style={[styles.btn, { marginTop: 16 }]} onPress={() => navigation.navigate('EditProfile')}>
          <Ionicons name="create-outline" size={18} color="white" /><Text style={styles.btnText}> Edit Profile</Text>
        </TouchableOpacity>
      </View>

      <View style={[styles.formCard, { margin: 16, marginTop: 0 }]}>
        <Text style={styles.formTitle}>Security</Text>
        <TouchableOpacity style={styles.secBtn} onPress={() => navigation.navigate('ChangePassword')}>
          <Ionicons name="key-outline" size={20} color={BLUE} /><Text style={styles.secBtnText}>Change Password</Text>
          <Ionicons name="chevron-forward" size={16} color={TEXT_LIGHT} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.secBtn} onPress={async () => { await auth().signOut(); navigation.reset({ index: 0, routes: [{ name: 'Auth' }] }); }}>
          <Ionicons name="log-out-outline" size={20} color={TEXT_MID} /><Text style={[styles.secBtnText, { color: TEXT_MID }]}>Logout</Text>
          <Ionicons name="chevron-forward" size={16} color={TEXT_LIGHT} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.deleteAccBtn} onPress={() => Alert.alert('Delete Account', 'Permanently delete your account?', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: async () => {
            await database().ref(`users/${currentUser!.uid}`).remove();
            await currentUser?.delete();
            navigation.reset({ index: 0, routes: [{ name: 'Auth' }] });
          }},
        ])}>
          <Ionicons name="trash-outline" size={18} color="white" />
          <Text style={styles.deleteAccText}>Delete Account</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
};

const InfoRow = ({ label, value }: { label: string; value?: string }) => (
  <View style={styles.infoRow}>
    <Text style={styles.infoLabel}>{label}</Text>
    <Text style={styles.infoValue}>{value || '—'}</Text>
  </View>
);

// ── Edit Profile ──────────────────────────────────────────────────────
const EditProfileScreen = ({ navigation }: any) => {
  const { currentUser, currentRole } = React.useContext(AppContext);
  const [shopName, setShopName] = useState('');
  const [shopNote, setShopNote] = useState('');
  const [shopAbout, setShopAbout] = useState('');
  const [shopType, setShopType] = useState('');
  const [shopPhone, setShopPhone] = useState('');
  const [shopLocation, setShopLocation] = useState('');
  const [shopCoords, setShopCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [fullName, setFullName] = useState('');
  const [age, setAge] = useState('');
  const [phone, setPhone] = useState('');
  const [location, setLocation] = useState('');
  const [locCoords, setLocCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoSaving, setPhotoSaving] = useState(false);

  useEffect(() => {
    if (!currentUser) return;
    database().ref(`users/${currentUser.uid}`).once('value').then(snap => {
      const d = snap.val() || {};
      if (currentRole === 'shopkeeper') {
        setShopName(d.shopName || ''); setShopNote(d.note || ''); setShopAbout(d.about || '');
        setShopType(d.type || ''); setPhoto(d.shopPhoto || null);
        setShopPhone(d.phone || '');
        setShopLocation(d.location || '');
        if (d.latitude && d.longitude) setShopCoords({ latitude: d.latitude, longitude: d.longitude });
      } else {
        setFullName(d.fullName || ''); setAge(d.age || ''); setPhone(d.phone || '');
        setLocation(d.location || ''); setPhoto(d.photoURL || null);
        if (d.latitude && d.longitude) setLocCoords({ latitude: d.latitude, longitude: d.longitude });
      }
    });
  }, [currentRole, currentUser]);

  const handlePickPhoto = () => pickPhoto(async b64 => {
    setPhoto(b64); setPhotoSaving(true);
    const key = currentRole === 'shopkeeper' ? 'shopPhoto' : 'photoURL';
    try { await database().ref(`users/${currentUser!.uid}`).update({ [key]: b64 }); } catch {}
    setPhotoSaving(false);
  });

  const handleSave = async () => {
    const updates: any = {};
    if (currentRole === 'shopkeeper') {
      updates.shopName = shopName; updates.note = shopNote; updates.about = shopAbout;
      updates.type = shopType; updates.phone = shopPhone.trim(); updates.location = shopLocation.trim();
      if (shopCoords) { updates.latitude = shopCoords.latitude; updates.longitude = shopCoords.longitude; }
    } else {
      updates.fullName = fullName; updates.age = age; updates.phone = phone; updates.location = location;
      if (locCoords) { updates.latitude = locCoords.latitude; updates.longitude = locCoords.longitude; }
    }
    await database().ref(`users/${currentUser!.uid}`).update(updates);
    navigation.goBack();
  };

  const displayPhoto = photo || (currentRole === 'shopkeeper' ? DEFAULT_SHOP_LOGO : DEFAULT_AVATAR);

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.formContainer} keyboardShouldPersistTaps="handled">
        <View style={styles.formCard}>
          <Text style={styles.formTitle}>✏️ Edit {currentRole === 'shopkeeper' ? 'Shop' : 'Profile'}</Text>
          <TouchableOpacity
            style={currentRole === 'shopkeeper' ? styles.shopPhotoPickerLarge : styles.avatarPicker}
            onPress={handlePickPhoto}>
            <Image source={{ uri: displayPhoto }}
              style={currentRole === 'shopkeeper' ? styles.shopPhotoImg : styles.avatarPickerImg} />
            <View style={styles.profileAvatarEdit}><Ionicons name="camera" size={14} color="white" /></View>
            {photoSaving && <View style={styles.photoOverlay}><ActivityIndicator color="white" /></View>}
          </TouchableOpacity>

          {currentRole === 'shopkeeper' ? (<>
            <Text style={styles.label}>Shop name</Text>
            <TextInput style={styles.input} value={shopName} onChangeText={setShopName} returnKeyType="next" />
            <Text style={styles.label}>Phone Number</Text>
            <View style={styles.phoneInputWrap}>
              <View style={styles.phoneFlag}><Text style={styles.phoneCountryCode}>🇮🇳 +91</Text></View>
              <TextInput style={styles.phoneInput} value={shopPhone} onChangeText={setShopPhone}
                placeholder="Mobile number" placeholderTextColor={TEXT_LIGHT} keyboardType="phone-pad" returnKeyType="next" maxLength={15} />
            </View>
            <LocationPicker value={shopLocation} onChange={setShopLocation}
              onCoordsChange={(lat, lng) => setShopCoords({ latitude: lat, longitude: lng })} label="Shop Location" />
            <Text style={styles.label}>Offer note</Text>
            <TextInput style={styles.input} value={shopNote} onChangeText={setShopNote} returnKeyType="next" />
            <Text style={styles.label}>About</Text>
            <TextInput style={[styles.input, styles.textArea]} multiline value={shopAbout} onChangeText={setShopAbout} />
            <Text style={styles.label}>Category</Text>
            <TextInput style={styles.input} value={shopType} onChangeText={setShopType} />
          </>) : (<>
            <Text style={styles.label}>Full name</Text>
            <TextInput style={styles.input} value={fullName} onChangeText={setFullName} returnKeyType="next" />
            <Text style={styles.label}>Age</Text>
            <TextInput style={styles.input} value={age} onChangeText={setAge} keyboardType="numeric" returnKeyType="next" />
            <Text style={styles.label}>Phone</Text>
            <TextInput style={styles.input} value={phone} onChangeText={setPhone} keyboardType="phone-pad" returnKeyType="next" />
            <LocationPicker value={location} onChange={setLocation}
              onCoordsChange={(lat, lng) => setLocCoords({ latitude: lat, longitude: lng })} />
          </>)}

          <View style={styles.formActions}>
            <TouchableOpacity style={[styles.btn, styles.btnOutline, { flex: 0.4 }]} onPress={() => navigation.goBack()}>
              <Text style={[styles.btnText, { color: BLUE }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, { flex: 1 }]} onPress={handleSave}>
              <Ionicons name="save-outline" size={18} color="white" /><Text style={styles.btnText}> Save</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

// ── Change Password ──────────────────────────────────────────────────
const ChangePasswordScreen = ({ navigation }: any) => {
  const [cur, setCur] = useState(''); const [nw, setNw] = useState(''); const [conf, setConf] = useState('');
  const [sc, setSc] = useState(false); const [sn, setSn] = useState(false); const [sconf, setSconf] = useState(false);
  const handle = async () => {
    if (!cur || !nw || !conf) { Alert.alert('Error', 'All fields required'); return; }
    if (nw !== conf) { Alert.alert('Error', 'Passwords do not match'); return; }
    if (nw.length < 6) { Alert.alert('Error', 'Minimum 6 characters'); return; }
    try {
      const user = auth().currentUser!;
      const cred = auth.EmailAuthProvider.credential(user.email!, cur);
      await user.reauthenticateWithCredential(cred);
      await user.updatePassword(nw);
      Alert.alert('✅ Password updated!'); navigation.goBack();
    } catch (e: any) { Alert.alert('Error', e.message); }
  };
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: BG }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.formContainer} keyboardShouldPersistTaps="handled">
        <View style={styles.formCard}>
          <Text style={styles.formTitle}>🔒 Change Password</Text>
          <Text style={styles.label}>Current password</Text>
          <PasswordInput value={cur} onChange={setCur} placeholder="Current password" show={sc} setShow={setSc} returnKeyType="next" />
          <Text style={styles.label}>New password</Text>
          <PasswordInput value={nw} onChange={setNw} placeholder="New password" show={sn} setShow={setSn} returnKeyType="next" />
          <Text style={styles.label}>Confirm new password</Text>
          <PasswordInput value={conf} onChange={setConf} placeholder="Confirm password" show={sconf} setShow={setSconf} returnKeyType="done" onSubmit={handle} />
          <View style={styles.formActions}>
            <TouchableOpacity style={[styles.btn, styles.btnOutline, { flex: 0.4 }]} onPress={() => navigation.goBack()}>
              <Text style={[styles.btnText, { color: BLUE }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, { flex: 1 }]} onPress={handle}>
              <Ionicons name="checkmark-outline" size={18} color="white" /><Text style={styles.btnText}> Update</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

// ── NavItem ──────────────────────────────────────────────────────────
const NavItem = ({ icon, label, active, onPress, badge }: any) => (
  <TouchableOpacity style={[styles.navItem, active && styles.navItemActive]} onPress={onPress}>
    <View style={{ position: 'relative' }}>
      <Ionicons name={icon} size={22} color={active ? 'white' : 'rgba(255,255,255,0.5)'} />
      {badge > 0 && (
        <View style={styles.navBadge}><Text style={styles.badgeText}>{badge > 9 ? '9+' : badge}</Text></View>
      )}
    </View>
    <Text style={[styles.navLabel, active && styles.navLabelActive]}>{label}</Text>
  </TouchableOpacity>
);

// ── App Navigator ────────────────────────────────────────────────────
const AppNavigatorInner = React.memo(({ currentUser }: { currentUser: FirebaseAuthTypes.User }) => {
  const [initialRoute, setInitialRoute] = useState<string | null>(null);

  useEffect(() => {
    database().ref(`users/${currentUser.uid}`).once('value').then(s => {
      const d = s.val() || {};
      if (d.role === 'shopkeeper' && !d.shopName) setInitialRoute('ShopkeeperDetails');
      else if (d.role === 'user' && !d.fullName) setInitialRoute('UserDetails');
      else if (d.role === 'shopkeeper') setInitialRoute('ShopkeeperDashboard');
      else if (d.role === 'user') setInitialRoute('UserDashboard');
      else setInitialRoute('Auth');
    });
  }, [currentUser.uid]);

  if (!initialRoute) return <View style={styles.loadingScreen}><ActivityIndicator size="large" color={BLUE} /></View>;

  return (
    <Stack.Navigator initialRouteName={initialRoute} screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
      <Stack.Screen name="Auth" component={AuthScreen} />
      <Stack.Screen name="ShopkeeperDetails" component={ShopkeeperDetailsForm} />
      <Stack.Screen name="UserDetails" component={UserDetailsForm} />
      <Stack.Screen name="ShopkeeperDashboard" component={ShopkeeperDashboard} />
      <Stack.Screen name="UserDashboard" component={UserDashboard} />
      <Stack.Screen name="ShopProducts" component={ShopProducts} options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="ProductDetail" component={ProductDetail} />
      <Stack.Screen name="EditProduct" component={EditProductForm} />
      <Stack.Screen name="Profile" component={ProfileScreen} />
      <Stack.Screen name="EditProfile" component={EditProfileScreen} />
      <Stack.Screen name="ChangePassword" component={ChangePasswordScreen} />
      <Stack.Screen name="Cart" component={CartScreen} />
    </Stack.Navigator>
  );
});

const AppNavigator = () => {
  const { currentUser, setCurrentUser, setCurrentRole } = React.useContext(AppContext);
  const [splashVisible, setSplashVisible] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const handleSplashFinish = useCallback(() => setSplashVisible(false), []);

  useEffect(() => {
    const unsub = auth().onAuthStateChanged(async user => {
      setCurrentUser(user);
      if (user) {
        const s = await database().ref(`users/${user.uid}`).once('value');
        setCurrentRole(s.val()?.role || null);
      } else {
        setCurrentRole(null);
      }
      setIsLoading(false);
    });
    return unsub;
  }, [setCurrentRole, setCurrentUser]);

  console.log('AppNavigator state', { splashVisible, isLoading, hasUser: !!currentUser });

  if (splashVisible) {
    return <SplashScreen onFinish={handleSplashFinish} />;
  }

  if (isLoading) {
    return (
      <View style={[styles.loadingScreen, { backgroundColor: '#222' }]}>
        <ActivityIndicator size="large" color={BLUE} />
        <Text style={{ marginTop: 12, color: 'white' }}>Checking login…</Text>
      </View>
    );
  }

  if (!currentUser) {
    return (
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Auth" component={AuthScreen} />
      </Stack.Navigator>
    );
  }

  return <AppNavigatorInner currentUser={currentUser} />;
};

// ── Root ─────────────────────────────────────────────────────────────

export default function App() {
  const [currentUser, setCurrentUser] = useState<FirebaseAuthTypes.User | null>(null);
  const [currentRole, setCurrentRole] = useState<UserRole>(null);
  const [tempProdPhoto, setTempProdPhoto] = useState<string | null>(null);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AppContext.Provider value={{ currentUser, currentRole, setCurrentUser, setCurrentRole, tempProdPhoto, setTempProdPhoto }}>
        <NavigationContainer>
          <AppNavigator />
        </NavigationContainer>
      </AppContext.Provider>
    </GestureHandlerRootView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  loadingScreen: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: BG },

  // Splash
  splash: { flex: 1, backgroundColor: DEEP_BLUE, alignItems: 'center', justifyContent: 'center' },
  splashLogo: { width: 100, height: 100, borderRadius: 32, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center', marginBottom: 20, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.3)', shadowColor: '#fff', shadowOpacity: 0.2, shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
  splashTitle: { fontSize: 36, fontWeight: '800', color: 'white', letterSpacing: -1, textAlign: 'center' },
  splashSub: { fontSize: 15, color: 'rgba(255,255,255,0.7)', marginTop: 8, textAlign: 'center' },

  // Navbar
  navbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: Platform.OS === 'ios' ? 56 : 20, paddingBottom: 14, backgroundColor: DEEP_BLUE, borderBottomWidth: 0 },
  navTitle: { fontSize: 18, fontWeight: '800', color: 'white', flex: 1, textAlign: 'center' },
  navSub: { fontSize: 12, color: 'rgba(255,255,255,0.7)', marginTop: 1 },
  navRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  navIconBtn: { position: 'relative' },
  navAvatar: { width: 38, height: 38, borderRadius: 19, borderWidth: 2, borderColor: 'rgba(255,255,255,0.4)' },
  backBtn: { flexDirection: 'row', alignItems: 'center', width: 32 },
  badge: { position: 'absolute', top: -6, right: -8, backgroundColor: ACCENT, borderRadius: 10, minWidth: 18, paddingVertical: 1, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'white' },
  navBadge: { position: 'absolute', top: -5, right: -7, backgroundColor: ACCENT, borderRadius: 9, minWidth: 16, paddingHorizontal: 3, alignItems: 'center', borderWidth: 2, borderColor: 'white' },
  badgeText: { color: 'white', fontSize: 10, fontWeight: '800' },

  // Auth
  authContainer: { flexGrow: 1, backgroundColor: 'transparent', paddingBottom: 0 },
  authHeader: { alignItems: 'center', paddingTop: 70, paddingBottom: 40, paddingHorizontal: 24 },
  authLogoBubble: { width: 80, height: 80, borderRadius: 26, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center', marginBottom: 16, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.3)' },
  authTitle: { fontSize: 32, fontWeight: '800', color: 'white', letterSpacing: -0.5 },
  authSubtitle: { fontSize: 15, color: 'rgba(255,255,255,0.75)', marginTop: 6, textAlign: 'center' },
  authCard: { backgroundColor: CARD, borderRadius: 28, padding: 22, borderWidth: 1, borderColor: BORDER, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.06, shadowRadius: 16, elevation: 2 },
  // Wave card design (replaces flat authCard)
  authWaveCard: { backgroundColor: CARD, borderTopLeftRadius: 40, borderTopRightRadius: 40, minHeight: 420, overflow: 'hidden' },
  authWaveTop: { height: 20, backgroundColor: CARD },
  errorBanner: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff5f5', borderRadius: 14, padding: 12, borderWidth: 1, borderColor: '#fcc' },
  errorIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#c0392b', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  errorTitle: { fontSize: 14, fontWeight: '700', color: TEXT_DARK },
  errorMsg: { fontSize: 12, color: '#6b4f4f', marginTop: 2 },
  tabRow: { flexDirection: 'row', borderBottomWidth: 1.5, borderBottomColor: BORDER, marginBottom: 20 },
  tabBtn: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabBtnActive: { borderBottomWidth: 2.5, borderBottomColor: BLUE },
  tabText: { fontWeight: '600', color: TEXT_MID, fontSize: 15 },
  tabTextActive: { color: BLUE, fontWeight: '700' },
  forgotLink: { alignSelf: 'flex-end', marginBottom: 20, marginTop: 4 },
  forgotText: { color: BLUE, fontWeight: '600', fontSize: 13 },
  roleLabel: { fontWeight: '700', color: TEXT_DARK, marginTop: 4, marginBottom: 10, fontSize: 14 },
  roleRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  roleBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 12, borderWidth: 1.5, borderColor: BLUE, borderRadius: 14, backgroundColor: 'white', gap: 8 },
  roleBtnActive: { backgroundColor: BLUE, borderColor: BLUE },
  roleBtnText: { color: BLUE, fontWeight: '700', fontSize: 14 },

  // ✅ NEW: Phone input styles
  phoneInputWrap: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, borderWidth: 1.5, borderColor: BLUE, borderRadius: 14, backgroundColor: '#f0f7ff', overflow: 'hidden' },
  phoneFlag: { backgroundColor: '#e8f0fe', paddingHorizontal: 14, paddingVertical: 13, borderRightWidth: 1, borderRightColor: BORDER, justifyContent: 'center', alignItems: 'center' },
  phoneCountryCode: { fontSize: 14, fontWeight: '700', color: BLUE },
  phoneInput: { flex: 1, paddingHorizontal: 14, paddingVertical: 13, fontSize: 15, color: TEXT_DARK },
  phoneHint: { fontSize: 11, color: TEXT_LIGHT, marginBottom: 14, marginTop: -4, paddingLeft: 2 },

  // Forms
  formContainer: { flexGrow: 1, backgroundColor: BG, padding: 20, paddingBottom: 40 },
  formCard: { backgroundColor: CARD, borderRadius: 24, padding: 22, borderWidth: 1, borderColor: BORDER, shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.05, shadowRadius: 12, elevation: 2 },
  formTitle: { fontSize: 22, fontWeight: '800', color: TEXT_DARK, marginBottom: 4 },
  formSub: { fontSize: 14, color: TEXT_MID, marginBottom: 22 },
  label: { fontSize: 13, fontWeight: '700', color: TEXT_MID, marginBottom: 6, marginTop: 4 },
  input: { width: '100%', paddingHorizontal: 16, paddingVertical: 13, marginBottom: 12, borderWidth: 1.5, borderColor: BORDER, borderRadius: 14, fontSize: 15, backgroundColor: '#fafcff', color: TEXT_DARK },
  textArea: { height: 80, textAlignVertical: 'top', borderRadius: 16 },
  pwWrap: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, borderWidth: 1.5, borderColor: BORDER, borderRadius: 14, backgroundColor: '#fafcff' },
  pwInput: { flex: 1, paddingHorizontal: 16, paddingVertical: 13, fontSize: 15, color: TEXT_DARK },
  pwEye: { position: 'absolute', right: 14 },
  picker: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 13, marginBottom: 12, borderWidth: 1.5, borderColor: BORDER, borderRadius: 14, backgroundColor: '#fafcff' },
  pickerText: { fontSize: 15, color: TEXT_DARK },
  genderRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  genderBtn: { flex: 1, paddingVertical: 11, alignItems: 'center', borderWidth: 1.5, borderColor: BLUE, borderRadius: 12, backgroundColor: 'white' },
  genderBtnActive: { backgroundColor: BLUE },
  genderText: { color: BLUE, fontWeight: '600', fontSize: 14 },
  row2: { flexDirection: 'row' },
  formActions: { flexDirection: 'row', gap: 10, marginTop: 8 },

  // Buttons
  btn: { backgroundColor: BLUE, paddingVertical: 14, paddingHorizontal: 22, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 8, shadowColor: BLUE, shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  btnOutline: { backgroundColor: 'white', borderWidth: 1.5, borderColor: BLUE, shadowOpacity: 0 },
  btnText: { color: 'white', fontSize: 15, fontWeight: '700' },

  // Photo pickers
  shopPhotoPickerLarge: { width: '100%', height: 130, borderRadius: 18, borderWidth: 2, borderColor: BORDER, borderStyle: 'dashed', backgroundColor: '#f4f8fd', marginBottom: 18, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  shopPhotoImg: { width: '100%', height: '100%', resizeMode: 'cover' },
  avatarPicker: { width: 100, height: 100, borderRadius: 50, borderWidth: 2, borderColor: BORDER, borderStyle: 'dashed', backgroundColor: '#f4f8fd', marginBottom: 18, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', alignSelf: 'center' },
  avatarPickerImg: { width: '100%', height: '100%', borderRadius: 50, resizeMode: 'cover' },
  productPhotoPicker: { width: 100, height: 100, borderRadius: 18, borderWidth: 2, borderColor: BORDER, borderStyle: 'dashed', backgroundColor: '#f4f8fd', marginBottom: 18, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  productPhotoImg: { width: '100%', height: '100%', resizeMode: 'cover' },
  photoPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  cameraCircle: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#e8f0fe', alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  photoHint: { fontSize: 12, color: TEXT_MID, fontWeight: '600' },
  photoOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },

  // Dashboard / shop banner
  shopBanner: { flexDirection: 'row', alignItems: 'center', backgroundColor: CARD, marginHorizontal: 16, marginTop: 14, padding: 14, borderRadius: 20, borderWidth: 1, borderColor: BORDER, gap: 14 },
  shopBannerImg: { width: 56, height: 56, borderRadius: 16 },
  shopBannerName: { fontSize: 17, fontWeight: '800', color: TEXT_DARK, marginBottom: 4 },
  shopBannerNote: { fontSize: 12, color: TEXT_MID, marginTop: 4 },
  typePill: { backgroundColor: '#e8f0fe', paddingVertical: 3, paddingHorizontal: 10, borderRadius: 20, alignSelf: 'flex-start' },
  typePillText: { color: BLUE, fontWeight: '700', fontSize: 11, textAlign:'center' },
  editFab: { width: 34, height: 34, borderRadius: 17, backgroundColor: BLUE, alignItems: 'center', justifyContent: 'center' },

  // ✅ NEW: Banner contact buttons (inside shop detail)
  bannerContactRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  bannerContactBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: CALL_BLUE, paddingVertical: 5, paddingHorizontal: 10, borderRadius: 10 },
  bannerContactText: { color: 'white', fontWeight: '700', fontSize: 11 },

  // ✅ NEW: Animated Shop Card styles
  shopCardEnhanced: { backgroundColor: CARD, borderRadius: 20, marginBottom: 14, borderWidth: 1, borderColor: BORDER, shadowColor: BLUE, shadowOpacity: 0.07, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 3, overflow: 'hidden' },
  shopCardTop: { flexDirection: 'row', alignItems: 'center', padding: 14 },
  shopImgWrap: { position: 'relative', marginRight: 14 },
  shopOnlineDot: { position: 'absolute', bottom: 2, right: 2, width: 12, height: 12, borderRadius: 6, backgroundColor: SUCCESS, borderWidth: 2, borderColor: CARD },
  shopCardImg: { width: 72, height: 72, borderRadius: 16 },
  shopCardBody: { flex: 1, gap: 4 },
  shopCardName: { fontSize: 16, fontWeight: '800', color: TEXT_DARK },
  shopCardNote: { fontSize: 12, color: TEXT_MID, marginTop: 2 },
  shopCardArrow: { backgroundColor: '#e8f0fe', width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 3 },
  shopLocationText: { fontSize: 11, color: TEXT_LIGHT, fontWeight: '500' },

  // ✅ NEW: Contact buttons row in shop card
  contactDivider: { height: 1, backgroundColor: BORDER, marginHorizontal: 14 },
  contactRow: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 12 },
  contactBtnsWrap: { flexDirection: 'row' },
  contactBtn: { borderRadius: 12, paddingVertical: 9, paddingHorizontal: 14, shadowOpacity: 0.18, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  contactBtnInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  contactBtnText: { color: 'white', fontWeight: '700', fontSize: 13 },

  // ✅ NEW: Section header with hint
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, marginBottom: 8, marginTop: 4 },
  sectionTitleLarge: { fontSize: 17, fontWeight: '800', color: TEXT_DARK },
  callHintPill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#e8f0fe', paddingVertical: 4, paddingHorizontal: 10, borderRadius: 20 },
  callHintText: { fontSize: 10, color: BLUE, fontWeight: '600' },

  // Segmented control
  segControl: { flexDirection: 'row', marginHorizontal: 16, marginVertical: 14, backgroundColor: '#e8f0fe', borderRadius: 14, padding: 4, marginTop: -30 },
  segBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 10, borderRadius: 11, gap: 6 },
  segBtnActive: { backgroundColor: BLUE, shadowColor: BLUE, shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  segText: { color: BLUE, fontWeight: '600', fontSize: 14 },
  segTextActive: { color: 'white', fontWeight: '700' },

  // Bottom bar — matches blue theme
  bottomBar: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', backgroundColor: DEEP_BLUE, paddingTop: 10, paddingBottom: Platform.OS === 'ios' ? 28 : 12, borderTopWidth: 0, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 16, shadowOffset: { width: 0, height: -4 }, elevation: 14 },
  navItem: { alignItems: 'center', paddingHorizontal: 14, paddingVertical: 4 },
  navItemActive: { alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.15)', paddingHorizontal: 18, paddingVertical: 6, borderRadius: 30, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  navLabel: { fontSize: 11, color: 'rgba(255,255,255,0.5)', fontWeight: '600', marginTop: 3 },
  navLabelActive: { fontSize: 11, color: 'white', fontWeight: '700', marginTop: 3 },

  // Blue header zone (dashboard, shop products, etc.)
  blueHeaderZone: { backgroundColor: DEEP_BLUE, overflow: 'hidden', paddingBottom: 44 },
  blueHeaderWave: { position: 'absolute', bottom: -22, left: -20, right: -20, height: 60, borderTopLeftRadius: 50, borderTopRightRadius: 50, backgroundColor: BG },
  navbarInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: Platform.OS === 'ios' ? 56 : 20, paddingBottom: 8 },
  navbarBlue: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: Platform.OS === 'ios' ? 56 : 20, paddingBottom: 14, backgroundColor: DEEP_BLUE },
  welcomeInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 14 },

  // Blue banner inside dashboard header
  shopBannerBlue: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginTop: 4, padding: 14, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)', gap: 14 },
  shopBannerNameWhite: { fontSize: 17, fontWeight: '800', color: 'white', marginBottom: 4 },
  shopBannerNoteWhite: { fontSize: 12, color: 'rgba(255,255,255,0.75)', marginTop: 4 },
  typePillLight: { backgroundColor: 'rgba(255,255,255,0.2)', paddingVertical: 3, paddingHorizontal: 10, borderRadius: 20, alignSelf: 'flex-start', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
  typePillLightText: { color: 'white', fontWeight: '700', fontSize: 11, textAlign: 'center' },
  editFabLight: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.9)', alignItems: 'center', justifyContent: 'center' },

  // Welcome card (kept for backward compat but now uses blueHeaderZone)
  welcomeCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: DEEP_BLUE, marginHorizontal: 0, marginTop: 0, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 22, borderBottomLeftRadius: 28, borderBottomRightRadius: 28 },
  welcomeLeft: { flex: 1 },
  welcomeGreeting: { fontSize: 17, fontWeight: '800', color: 'white' },
  welcomeLocation: { fontSize: 13, color: 'rgba(255,255,255,0.75)', marginTop: 3 },

  // Search
  searchBar: { backgroundColor: CARD, marginHorizontal: 16, marginBottom: 4, marginTop: -30, paddingHorizontal: 14, paddingVertical: 2, borderRadius: 14, borderWidth: 1.5, borderColor: BORDER, flexDirection: 'row', alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  searchInput: { flex: 1, paddingVertical: 11, marginLeft: 8, fontSize: 15, color: TEXT_DARK },

  // Product card
  productCard: { backgroundColor: CARD, borderRadius: 18, padding: 14, marginBottom: 12, flexDirection: 'row', borderWidth: 1, borderColor: BORDER, shadowColor: '#000', shadowOpacity: 0.03, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  productImg: { width: 84, height: 84, borderRadius: 16, marginRight: 14 },
  productInfo: { flex: 1 },
  productName: { fontSize: 15, fontWeight: '700', color: TEXT_DARK },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  productPrice: { fontSize: 15, fontWeight: '800', color: BLUE },
  productQty: { fontSize: 12, color: TEXT_MID, fontWeight: '500', backgroundColor: BORDER, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  productNote: { fontSize: 12, color: TEXT_MID, marginTop: 3 },
  productActions: { flexDirection: 'row', marginTop: 10, gap: 6 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', paddingVertical: 5, paddingHorizontal: 10, borderWidth: 1, borderColor: BLUE, borderRadius: 10, gap: 4 },
  actionText: { color: BLUE, fontWeight: '600', fontSize: 12 },
  addCartBtn: { backgroundColor: ACCENT, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 10, flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', marginTop: 8, gap: 4 },
  addCartText: { color: 'white', fontWeight: '700', fontSize: 12 },

  // Search filter row
  searchFilterRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8, gap: 8 },
  filterBtn: { padding: 10, borderRadius: 12, backgroundColor: '#e8f0fe' },
  filterBtnActive: { backgroundColor: BLUE },
  filterPanel: { paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#e8f0fe', borderBottomWidth: 1, borderBottomColor: BORDER },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: CARD, marginRight: 4, marginBottom: 4 },
  chipActive: { backgroundColor: BLUE },
  chipText: { fontSize: 12, color: TEXT_DARK, fontWeight: '600' },
  chipTextActive: { color: 'white', fontWeight: '700' },

  // Product detail
  detailCard: { backgroundColor: CARD, margin: 16, borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: BORDER },
  detailImg: { width: '100%', height: 200, resizeMode: 'cover' },
  detailBody: { padding: 18 },
  detailName: { fontSize: 22, fontWeight: '800', color: TEXT_DARK },
  detailPrice: { fontSize: 24, fontWeight: '800', color: DARK_BLUE },
  shopRef: { fontSize: 13, color: TEXT_MID, marginTop: 8 },
  addCartBtnLg: { backgroundColor: ACCENT, paddingVertical: 13, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 16 },
  sectionCard: { backgroundColor: CARD, marginHorizontal: 16, marginBottom: 14, padding: 18, borderRadius: 20, borderWidth: 1, borderColor: BORDER },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  sectionTitle: { fontSize: 17, fontWeight: '800', color: TEXT_DARK },
  ratingPill: { backgroundColor: '#fff9e6', paddingVertical: 3, paddingHorizontal: 10, borderRadius: 12 },
  ratingPillText: { color: '#f39c12', fontWeight: '700', fontSize: 13 },
  emptyText: { color: TEXT_LIGHT, fontStyle: 'italic', textAlign: 'center', paddingVertical: 8 },
  emptyState: { alignItems: 'center', paddingVertical: 60, gap: 12 },
  reviewCard: { backgroundColor: BG, borderRadius: 14, padding: 14, marginBottom: 10 },
  reviewTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  reviewUser: { fontWeight: '700', color: TEXT_DARK },
  reviewStars: { color: '#ffb82e', fontWeight: '700' },
  reviewComment: { color: TEXT_DARK, fontSize: 14 },
  addReview: { marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: BORDER },
  subSectionTitle: { fontSize: 14, fontWeight: '700', color: TEXT_DARK, marginBottom: 10 },
  starRow: { flexDirection: 'row', marginBottom: 12, gap: 6 },
  smallBtn: { backgroundColor: BLUE, paddingVertical: 9, paddingHorizontal: 18, borderRadius: 12, alignSelf: 'flex-start', marginTop: 8, flexDirection: 'row', alignItems: 'center' },
  smallBtnText: { color: 'white', fontWeight: '700', fontSize: 13 },
  qCard: { backgroundColor: BG, borderRadius: 14, padding: 14, marginBottom: 12 },
  qUser: { fontWeight: '700', color: TEXT_DARK, fontSize: 13, marginBottom: 4 },
  qQuestion: { color: BLUE, fontWeight: '600', fontSize: 14 },
  answerBox: { backgroundColor: '#f0f9f0', padding: 12, borderRadius: 12, marginTop: 8 },
  answerText: { color: SUCCESS, fontWeight: '600', fontSize: 14 },
  awaitingText: { color: TEXT_LIGHT, fontStyle: 'italic', marginTop: 6, fontSize: 13 },

  // Cart
  checkoutBar: { position: 'absolute', bottom: 74, left: 16, right: 16, backgroundColor: CARD, borderRadius: 20, padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderWidth: 1, borderColor: BORDER, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: -3 }, elevation: 6 },
  totalLabel: { fontSize: 13, color: TEXT_MID, fontWeight: '600' },
  totalAmount: { fontSize: 22, fontWeight: '800', color: TEXT_DARK },
  removeBtn: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  removeBtnText: { color: '#e74c3c', fontWeight: '600', fontSize: 13 },

  // Profile
  profileHero: { alignItems: 'center', paddingVertical: 28, backgroundColor: DEEP_BLUE, borderBottomWidth: 0 },
  profileAvatarWrap: { position: 'relative', marginBottom: 14 },
  profileAvatar: { width: 96, height: 96, borderRadius: 48, borderWidth: 3, borderColor: 'rgba(255,255,255,0.4)' },
  profileAvatarEdit: { position: 'absolute', bottom: 0, right: 0, backgroundColor: 'rgba(255,255,255,0.9)', width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: DEEP_BLUE },
  profileName: { fontSize: 22, fontWeight: '800', color: 'white' },
  profileEmail: { fontSize: 13, color: 'rgba(255,255,255,0.7)', marginTop: 4 },
  infoRow: { flexDirection: 'row', marginBottom: 12, alignItems: 'flex-start' },
  infoLabel: { width: '38%', color: TEXT_MID, fontWeight: '600', fontSize: 13 },
  infoValue: { flex: 1, color: TEXT_DARK, fontWeight: '700', fontSize: 14 },
  secBtn: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: BORDER, gap: 12 },
  secBtnText: { flex: 1, fontSize: 15, fontWeight: '600', color: BLUE },
  deleteAccBtn: { backgroundColor: '#e74c3c', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 13, borderRadius: 14, marginTop: 14, gap: 8 },
  deleteAccText: { color: 'white', fontWeight: '700', fontSize: 15 },

  // Location picker
  locationPickerWrap: { flexDirection: 'row', alignItems: 'center', marginBottom: 4, borderWidth: 1.5, borderColor: BLUE, borderRadius: 14, backgroundColor: '#f0f7ff', overflow: 'hidden' },
  locationInput: { flex: 1, paddingHorizontal: 16, paddingVertical: 13, fontSize: 15, color: TEXT_DARK },
  locationDetectBtn: { backgroundColor: BLUE, paddingHorizontal: 14, paddingVertical: 13, flexDirection: 'row', alignItems: 'center', gap: 5, borderLeftWidth: 1, borderLeftColor: 'rgba(26,115,232,0.3)', borderRadius: 14 },
  locationDetectText: { color: 'white', fontWeight: '700', fontSize: 12 },
  locationDetectRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },

  // Dashboard filter bar
  filterBarRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4, marginTop: 12, marginBottom: 8, gap: 8 },
  cityFilterBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: CARD, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 20, borderWidth: 1.5, borderColor: BLUE, shadowColor: BLUE, shadowOpacity: 0.1, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 2, maxWidth: '45%' },
  cityFilterText: { color: BLUE, fontWeight: '700', fontSize: 12, flex: 1 },

  // Distance pill on shop card
  distancePill: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#e6f4ea', paddingVertical: 3, paddingHorizontal: 8, borderRadius: 20 },
  distancePillText: { color: SUCCESS, fontWeight: '700', fontSize: 10 },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: CARD, borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: '72%', paddingBottom: 36 },
  modalHandle: { width: 40, height: 5, backgroundColor: BORDER, borderRadius: 3, alignSelf: 'center', marginTop: 12, marginBottom: 4 },
  modalTitle: { fontSize: 17, fontWeight: '800', color: TEXT_DARK, padding: 18, borderBottomWidth: 1, borderBottomColor: BORDER },
  modalItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: '#f5f5f5' },
  modalItemText: { fontSize: 15, color: TEXT_DARK },
});