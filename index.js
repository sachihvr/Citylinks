import 'react-native-gesture-handler';
import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

// Registering 'main' satisfies the Android Native ignition
AppRegistry.registerComponent('main', () => App);

// Registering appName satisfies standard React Native
AppRegistry.registerComponent(appName, () => App);