type AlertLocation = {
  lat: number;
  lng: number;
  updatedAt: number;
};

let latestAlertLocation: AlertLocation | null = null;

export function setAlertLocation(lat: number, lng: number) {
  latestAlertLocation = {
    lat,
    lng,
    updatedAt: Date.now(),
  };
}

export function getAlertLocation() {
  return latestAlertLocation;
}
