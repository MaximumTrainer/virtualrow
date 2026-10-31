// Web Bluetooth API type definitions
declare global {
  interface Navigator {
    bluetooth?: Bluetooth;
  }

  interface Bluetooth {
    requestDevice(options: RequestDeviceOptions): Promise<BluetoothDevice>;
    getAvailability(): Promise<boolean>;
    getDevices(): Promise<BluetoothDevice[]>;
  }

  interface RequestDeviceOptions {
    filters?: BluetoothDeviceFilter[];
    optionalServices?: string[];
    optionalManufacturerData?: BluetoothManufacturerDataFilter[];
  }

  interface BluetoothDeviceFilter {
    services?: string[];
    namePrefix?: string;
    name?: string;
  }

  interface BluetoothManufacturerDataFilter {
    companyIdentifier: number;
    dataPrefix?: BufferSource;
    mask?: BufferSource;
  }

  interface BluetoothDevice extends EventTarget {
    id: string;
    name?: string;
    gatt?: BluetoothRemoteGATTServer;
    forget(): Promise<void>;
    watchAdvertisements(): Promise<void>;
    unwatchAdvertisements(): void;
    addEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions
    ): void;
    removeEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | EventListenerOptions
    ): void;
    dispatchEvent(event: Event): boolean;
  }

  interface BluetoothRemoteGATTServer {
    device: BluetoothDevice;
    connected: boolean;
    connect(): Promise<BluetoothRemoteGATTServer>;
    disconnect(): void;
    getPrimaryService(
      service: string | number
    ): Promise<BluetoothRemoteGATTService>;
    getPrimaryServices(
      service?: string | number
    ): Promise<BluetoothRemoteGATTService[]>;
  }

  interface BluetoothRemoteGATTService extends BluetoothRemoteGATTObject {
    uuid: string;
    isPrimary: boolean;
    getCharacteristic(
      characteristic: string | number
    ): Promise<BluetoothRemoteGATTCharacteristic>;
    getCharacteristics(
      characteristic?: string | number
    ): Promise<BluetoothRemoteGATTCharacteristic[]>;
  }

  interface BluetoothRemoteGATTCharacteristic extends BluetoothRemoteGATTObject {
    service: BluetoothRemoteGATTService;
    uuid: string;
    properties: BluetoothCharacteristicProperties;
    value?: DataView;
    readValue(): Promise<DataView>;
    writeValue(value: BufferSource): Promise<void>;
    writeValueWithoutResponse(value: BufferSource): Promise<void>;
    startNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
    stopNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
    getDescriptor(
      descriptor: string | number
    ): Promise<BluetoothRemoteGATTDescriptor>;
    getDescriptors(
      descriptor?: string | number
    ): Promise<BluetoothRemoteGATTDescriptor[]>;
    addEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions
    ): void;
  }

  interface BluetoothRemoteGATTObject {
    service?: BluetoothRemoteGATTService;
  }

  interface BluetoothCharacteristicProperties {
    broadcast: boolean;
    read: boolean;
    writeWithoutResponse: boolean;
    write: boolean;
    notify: boolean;
    indicate: boolean;
    authenticatedSignedWrites: boolean;
    reliableWrite: boolean;
    writableAuxiliaries: boolean;
  }

  interface BluetoothRemoteGATTDescriptor {
    characteristic: BluetoothRemoteGATTCharacteristic;
    uuid: string;
    value?: DataView;
    readValue(): Promise<DataView>;
    writeValue(value: BufferSource): Promise<void>;
  }
}

export {};
