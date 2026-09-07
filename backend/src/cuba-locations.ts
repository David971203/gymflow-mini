import { BadRequestException } from '@nestjs/common';

export const CUBA_LOCATIONS: Record<string, readonly string[]> = {
  'Pinar del Río': ['Consolación del Sur','Guane','La Palma','Los Palacios','Mantua','Minas de Matahambre','Pinar del Río','San Juan y Martínez','San Luis','Sandino','Viñales'],
  Artemisa: ['Alquízar','Artemisa','Bauta','Caimito','Guanajay','Güira de Melena','Mariel','San Antonio de los Baños','Bahía Honda','San Cristóbal','Candelaria'],
  Mayabeque: ['Batabanó','Bejucal','Güines','Jaruco','Madruga','Melena del Sur','Nueva Paz','Quivicán','San José de las Lajas','San Nicolás de Bari','Santa Cruz del Norte'],
  'La Habana': ['Arroyo Naranjo','Boyeros','Centro Habana','Cerro','Cotorro','Diez de Octubre','Guanabacoa','Habana del Este','Habana Vieja','La Lisa','Marianao','Playa','Plaza','Regla','San Miguel del Padrón'],
  Matanzas: ['Calimete','Cárdenas','Ciénaga de Zapata','Colón','Jagüey Grande','Jovellanos','Limonar','Los Arabos','Martí','Matanzas','Pedro Betancourt','Perico','Unión de Reyes'],
  Cienfuegos: ['Abreus','Aguada de Pasajeros','Cienfuegos','Cruces','Cumanayagua','Palmira','Rodas','Santa Isabel de las Lajas'],
  'Villa Clara': ['Caibarién','Camajuaní','Cifuentes','Corralillo','Encrucijada','Manicaragua','Placetas','Quemado de Güines','Ranchuelo','Remedios','Sagua la Grande','Santa Clara','Santo Domingo'],
  'Sancti Spíritus': ['Cabaigúan','Fomento','Jatibonico','La Sierpe','Sancti Spíritus','Taguasco','Trinidad','Yaguajay'],
  'Ciego de Ávila': ['Ciro Redondo','Baraguá','Bolivia','Chambas','Ciego de Ávila','Florencia','Majagua','Morón','Primero de Enero','Venezuela'],
  Camagüey: ['Camagüey','Carlos Manuel de Céspedes','Esmeralda','Florida','Guaimaro','Jimagüayú','Minas','Najasa','Nuevitas','Santa Cruz del Sur','Sibanicú','Sierra de Cubitas','Vertientes'],
  'Las Tunas': ['Amancio Rodríguez','Colombia','Jesús Menéndez','Jobabo','Las Tunas','Majibacoa','Manatí','Puerto Padre'],
  Holguín: ['Antilla','Báguanos','Banes','Cacocum','Calixto García','Cueto','Frank País','Gibara','Holguín','Mayarí','Moa','Rafael Freyre','Sagua de Tánamo','Urbano Noris'],
  Granma: ['Bartolomé Masó','Bayamo','Buey Arriba','Campechuela','Cauto Cristo','Guisa','Jiguaní','Manzanillo','Media Luna','Niquero','Pilón','Río Cauto','Yara'],
  'Santiago de Cuba': ['Contramaestre','Guamá','Julio Antonio Mella','Palma Soriano','San Luis','Santiago de Cuba','Segundo Frente','Songo la Maya','Tercer Frente'],
  Guantánamo: ['Baracoa','Caimanera','El Salvador','Guantánamo','Imías','Maisí','Manuel Tames','Niceto Pérez','San Antonio del Sur','Yateras'],
  'Isla de la Juventud': ['Isla de la Juventud'],
};

export function assertCubanLocation(province: string, municipality: string) {
  const municipalities=CUBA_LOCATIONS[province];
  if (!municipalities) throw new BadRequestException('Selecciona una provincia válida');
  if (!municipalities.includes(municipality)) throw new BadRequestException('Selecciona un municipio válido para la provincia indicada');
}
