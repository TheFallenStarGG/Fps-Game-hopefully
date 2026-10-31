/** Simple blocky character + rifle */

export function makeHumanoid(THREE, primary, secondary, isPlayer) {
  const root = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: primary, roughness: 0.7 });
  const darkMat = new THREE.MeshStandardMaterial({ color: secondary, roughness: 0.65 });
  const skinMat = new THREE.MeshStandardMaterial({
    color: isPlayer ? 0xc4a574 : 0x8a6a55,
    roughness: 0.75,
  });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.7, 0.32), bodyMat);
  torso.position.y = 1.15;
  torso.castShadow = true;
  root.add(torso);

  const headM = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.36, 0.32), skinMat);
  headM.position.y = 1.7;
  headM.castShadow = true;
  root.add(headM);

  const helm = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.36), darkMat);
  helm.position.y = 1.88;
  root.add(helm);

  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.55, 0.22), darkMat);
  legL.position.set(-0.14, 0.35, 0);
  const legR = legL.clone();
  legR.position.x = 0.14;
  root.add(legL, legR);

  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.55, 0.16), bodyMat);
  armL.position.set(-0.4, 1.15, 0);
  const armR = armL.clone();
  armR.position.x = 0.4;
  root.add(armL, armR);

  const rifle = new THREE.Group();
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.25), darkMat);
  stock.position.set(0.28, 1.15, -0.15);
  const rec = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 0.14, 0.45),
    new THREE.MeshStandardMaterial({ color: 0x2a2c30, metalness: 0.4, roughness: 0.4 })
  );
  rec.position.set(0.28, 1.18, -0.45);
  const bar = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 0.05, 0.4),
    new THREE.MeshStandardMaterial({ color: 0x111 })
  );
  bar.position.set(0.28, 1.2, -0.8);
  rifle.add(stock, rec, bar);
  root.add(rifle);

  const viewmodel = new THREE.Group();
  const vmBody = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.12, 0.55),
    new THREE.MeshStandardMaterial({ color: 0x222428, metalness: 0.4, roughness: 0.4 })
  );
  vmBody.position.set(0.22, -0.18, -0.45);
  const vmBar = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 0.05, 0.35),
    new THREE.MeshStandardMaterial({ color: 0x111113 })
  );
  vmBar.position.set(0.22, -0.14, -0.78);
  viewmodel.add(vmBody, vmBar);
  viewmodel.visible = false;
  root.userData = { torso, headM, armR, rifle, viewmodel };
  return root;
}
