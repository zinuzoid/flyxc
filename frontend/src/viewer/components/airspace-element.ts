import {
  css,
  CSSResult,
  customElement,
  html,
  internalProperty,
  LitElement,
  property,
  PropertyValues,
  TemplateResult,
} from 'lit-element';
import { connect } from 'pwa-helpers';

import { RuntimeTrack } from '../../../../common/track';
import { setAspAltitude, setAspShowRestricted } from '../actions/map';
import { AspAt, AspMapType, AspZoomMapType, MAX_ASP_TILE_ZOOM } from '../logic/airspaces';
import { sampleAt } from '../logic/math';
import { formatUnit } from '../logic/units';
import { activeTrack, aspAltitudeStops, currentAspAltitudeStop } from '../selectors/map';
import { RootState, store } from '../store';
import { controlHostStyle } from './control-style';

@customElement('airspace-ctrl-element')
export class AirspaceCtrlElement extends connect(store)(LitElement) {
  @property()
  get map(): google.maps.Map | null {
    return this.map_;
  }
  set map(map: google.maps.Map | null) {
    this.map_ = map;
    if (map) {
      if (this.overlays.length == 0) {
        // Add the overlays for different zoom levels.
        this.overlays = [new AspMapType(this.altitudeStop, MAX_ASP_TILE_ZOOM)];
        for (let zoom = MAX_ASP_TILE_ZOOM + 1; zoom <= 17; zoom++) {
          this.overlays.push(new AspZoomMapType(this.altitudeStop, MAX_ASP_TILE_ZOOM, zoom));
        }
        this.setOverlaysZoom();
        this.info = new google.maps.InfoWindow({ disableAutoPan: true });
        this.info.close();
        map.addListener('click', (e: google.maps.MouseEvent): void => this.handleClick(e.latLng));
        map.addListener('zoom_changed', () => this.setOverlaysZoom());
      }
    }
  }

  map_: google.maps.Map | null = null;

  @internalProperty()
  expanded = false;

  @internalProperty()
  units: any = null;

  @internalProperty()
  ts = 0;

  @internalProperty()
  airspaces: string[] = [];

  // Current altitude stop in meters.
  @internalProperty()
  altitudeStop = 1000;

  // List of altitude stops.
  @internalProperty()
  altitudeStops: number[] = [];

  // Whether to display restricted airspaces.
  @internalProperty()
  aspShowRestricted = true;

  @internalProperty()
  track: RuntimeTrack | null = null;

  overlays: AspMapType[] = [];

  info: google.maps.InfoWindow | null = null;

  stateChanged(state: RootState): void {
    if (state.map) {
      this.units = state.map.units;
      this.altitudeStop = currentAspAltitudeStop(state.map);
      this.altitudeStops = aspAltitudeStops(state.map);
      this.aspShowRestricted = state.map.aspShowRestricted;
      this.track = activeTrack(state.map);
      this.ts = state.map.chart.ts;
      this.airspaces = state.map.chart.airspaces;
    }
  }

  shouldUpdate(changedProperties: PropertyValues): boolean {
    if (this.expanded) {
      // Need to remove and re-add the overlays to change the altitude / restricted visibility.
      if (changedProperties.has('altitudeStop') || changedProperties.has('aspShowRestricted')) {
        this.removeOverlays();
        this.addOverlays();
      }
      if (this.track && (changedProperties.has('ts') || changedProperties.has('airspaces'))) {
        if (this.airspaces.length) {
          const fixes = this.track.fixes;
          const lat = sampleAt(fixes.ts, fixes.lat, [this.ts])[0];
          const lng = sampleAt(fixes.ts, fixes.lon, [this.ts])[0];
          this.info?.setContent(this.airspaces.map((t) => `<b>${t}</b>`).join('<br>'));
          this.info?.setPosition({ lat, lng });
          this.info?.open(this.map ?? undefined);
        } else {
          this.info?.close();
        }
        changedProperties.delete('ts');
        changedProperties.delete('airspaces');
      }
    }
    return super.shouldUpdate(changedProperties);
  }

  static get styles(): CSSResult[] {
    return [
      controlHostStyle,
      css`
        select {
          font: inherit;
        }
      `,
    ];
  }

  protected toggleExpanded(): void {
    this.expanded = !this.expanded;
    if (!this.expanded) {
      this.info?.close();
    }
  }

  render(): TemplateResult {
    return html`
      <link
        rel="stylesheet"
        href="https://cdn.jsdelivr.net/npm/line-awesome@1/dist/line-awesome/css/line-awesome.min.css"
      />
      <div style="float:left;margin-right:5px" .hidden=${!this.expanded}>
        <label
          ><input type="checkbox" ?checked=${this.aspShowRestricted} @change=${this.handleRestricted} />E, F, G,
          RESTRICTED</label
        >
        <select value=${this.altitudeStop} @change=${this.handleAltitudeChange}>
          ${this.altitudeStops.map(
            (stop: number) =>
              html`<option value=${stop} ?selected=${stop == this.altitudeStop}
                >${formatUnit(stop, this.units.altitude)}</option
              > `,
          )}
        </select>
      </div>
      <i class="la la-fighter-jet la-2x" style="cursor: pointer" @click=${this.toggleExpanded}></i>
    `;
  }

  // Show/hide restricted airspaces.
  protected handleRestricted(e: Event): void {
    const show = (e.target as HTMLInputElement).checked;
    store.dispatch(setAspShowRestricted(show));
  }

  // Set the max altitude to display airspaces.
  protected handleAltitudeChange(e: CustomEvent): void {
    const altitude = (e.target as HTMLInputElement).value;
    store.dispatch(setAspAltitude(altitude));
  }

  protected handleClick(latLng: google.maps.LatLng): void {
    if (this.expanded && this.map) {
      this.info?.close();
      const html = AspAt(
        this.map.getZoom(),
        { lat: latLng.lat(), lon: latLng.lng() },
        this.altitudeStop,
        this.aspShowRestricted,
      );
      if (html) {
        this.info?.setContent(html);
        this.info?.setPosition(latLng);
        this.info?.open(this.map);
      }
    }
  }

  updated(changedProperties: PropertyValues): void {
    if (this.map) {
      if (changedProperties.has('expanded')) {
        if (this.expanded) {
          this.addOverlays();
        } else {
          this.removeOverlays();
        }
      }
    }
    super.updated(changedProperties);
  }

  protected addOverlays(): void {
    this.overlays.forEach((o) => {
      if (this.map?.overlayMapTypes) {
        o.setAltitude(this.altitudeStop);
        o.setShowRestricted(this.aspShowRestricted);
        this.map.overlayMapTypes.push(o);
      }
    });
  }

  protected removeOverlays(): void {
    if (this.map) {
      for (let i = this.map.overlayMapTypes.getLength() - 1; i >= 0; i--) {
        const o = this.map.overlayMapTypes.getAt(i);
        if (o instanceof AspMapType || o instanceof AspZoomMapType) {
          this.map.overlayMapTypes.removeAt(i);
        }
      }
    }
  }

  // Broadcast the current zoom level to the overlays so that they know when they are active.
  protected setOverlaysZoom(): void {
    if (this.map_) {
      const zoom = this.map_.getZoom();
      this.overlays.forEach((overlay) => overlay.setCurrentZoom(zoom));
    }
  }
}
